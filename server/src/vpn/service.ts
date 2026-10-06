// Подписка и ключ юзера: пробный период, перевыпуск ссылки, сводка для кабинета,
// синхронизация с панелью 3x-ui.
//
// Источник правды — наша база. Панель — исполнитель: после каждого изменения клиента
// в панели приводим к состоянию базы (syncUser). Если панель была недоступна, изменение
// подхватит периодическая сверка (reconcile) — юзер ничего делать не должен.

import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import type { Databases } from '../db/db.js';
import type { XuiApi, XuiClientInput } from '../xui/client.js';
import type { VpnTopology } from '../xui/setup.js';

export interface VpnConfig {
  trialDays: number;
  deviceLimit: number;
  subscriptionBaseUrl: string; // https://mraz1vpn.ru/sub/
}

export type VpnStatus = 'none' | 'trial' | 'active' | 'expired';

export interface VpnSummary {
  status: VpnStatus;
  expiresAt: string | null;
  trialAvailable: boolean;
  trialDays: number;
  deviceLimit: number;
  subscriptionUrl: string | null;
}

export class VpnError extends Error {
  constructor(readonly code: 'trial_used' | 'has_subscription' | 'no_subscription') {
    super(code);
  }
}

/** Логин клиента в панели. Один на юзера, не меняется при перевыпуске ключа. */
export const panelEmail = (userId: number) => `tg${userId}`;

const newSubToken = () => randomBytes(24).toString('base64url');
export const SUB_TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export function createVpnService(deps: {
  dbs: Databases;
  config: VpnConfig;
  xui: XuiApi;
  topology: () => Promise<VpnTopology>;
  log: Logger;
  now?: () => Date;
}) {
  const { dbs, config, xui, log } = deps;
  const now = deps.now ?? (() => new Date());

  /** Сводка для кабинета. Читается под ролью юзера — RLS не даст увидеть чужое. */
  async function getSummary(userId: number): Promise<VpnSummary> {
    return dbs.asUser(userId, async (tx) => {
      const user = await tx.selectFrom('users').select(['trial_used_at']).executeTakeFirst();
      const sub = await tx
        .selectFrom('subscriptions')
        .select(['id', 'status', 'expires_at', 'device_limit'])
        .where('status', '<>', 'archived')
        .executeTakeFirst();
      const key = sub
        ? await tx
            .selectFrom('vpn_keys')
            .select(['sub_token'])
            .where('subscription_id', '=', sub.id)
            .where('revoked_at', 'is', null)
            .executeTakeFirst()
        : undefined;

      let status: VpnStatus = 'none';
      if (sub) {
        const alive = sub.expires_at !== null && sub.expires_at > now();
        status = !alive ? 'expired' : sub.status === 'trial' ? 'trial' : 'active';
      }
      return {
        status,
        expiresAt: sub?.expires_at?.toISOString() ?? null,
        trialAvailable: !sub && !user?.trial_used_at,
        trialDays: config.trialDays,
        deviceLimit: sub?.device_limit ?? config.deviceLimit,
        subscriptionUrl: key ? config.subscriptionBaseUrl + key.sub_token : null,
      };
    });
  }

  /** Пробный период: один раз на аккаунт. Пишет сервер (mraz_system), userId — из сессии. */
  async function startTrial(userId: number): Promise<void> {
    await dbs.system.transaction().execute(async (tx) => {
      const user = await tx
        .selectFrom('users')
        .select(['id', 'trial_used_at'])
        .where('id', '=', userId)
        .forUpdate()
        .executeTakeFirst();
      if (!user) throw new Error('startTrial: юзер не найден');
      if (user.trial_used_at) throw new VpnError('trial_used');

      const existing = await tx
        .selectFrom('subscriptions')
        .select('id')
        .where('user_id', '=', userId)
        .where('status', '<>', 'archived')
        .executeTakeFirst();
      if (existing) throw new VpnError('has_subscription');

      await tx.updateTable('users').set({ trial_used_at: sql<Date>`now()` }).where('id', '=', userId).execute();
      const sub = await tx
        .insertInto('subscriptions')
        .values({
          user_id: userId,
          status: 'trial',
          expires_at: sql<Date>`now() + make_interval(days => ${config.trialDays})`,
          device_limit: config.deviceLimit,
          archived_at: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await tx
        .insertInto('vpn_keys')
        .values({ user_id: userId, subscription_id: sub.id, sub_token: newSubToken(), revoked_at: null, panel_synced_at: null })
        .execute();
    });
    await syncUserSafe(userId);
  }

  /** Новая ссылка и новый UUID: старая ссылка перестаёт работать, все устройства отключаются. */
  async function rotateKey(userId: number): Promise<void> {
    await dbs.system.transaction().execute(async (tx) => {
      const sub = await tx
        .selectFrom('subscriptions')
        .select('id')
        .where('user_id', '=', userId)
        .where('status', '<>', 'archived')
        .forUpdate()
        .executeTakeFirst();
      if (!sub) throw new VpnError('no_subscription');
      await tx
        .updateTable('vpn_keys')
        .set({ revoked_at: sql<Date>`now()` })
        .where('subscription_id', '=', sub.id)
        .where('revoked_at', 'is', null)
        .execute();
      await tx
        .insertInto('vpn_keys')
        .values({ user_id: userId, subscription_id: sub.id, sub_token: newSubToken(), revoked_at: null, panel_synced_at: null })
        .execute();
    });
    await syncUserSafe(userId);
  }

  /** Приводит клиента юзера в панели к состоянию базы. Повторный вызов безопасен. */
  async function syncUser(userId: number): Promise<void> {
    const t = await deps.topology();
    const row = await dbs.system
      .selectFrom('subscriptions as s')
      .innerJoin('vpn_keys as k', (j) => j.onRef('k.subscription_id', '=', 's.id').on('k.revoked_at', 'is', null))
      .select(['s.expires_at', 's.device_limit', 'k.id as key_id', 'k.xray_uuid'])
      .where('s.user_id', '=', userId)
      .where('s.status', '<>', 'archived')
      .executeTakeFirst();

    const email = panelEmail(userId);
    const current = await xui.getClient(email);

    if (!row) {
      // Подписки нет — клиента в панели быть не должно (или он выключен).
      if (current?.client.enable) {
        await xui.updateClient(email, { ...toInput(current), enable: false });
      }
      return;
    }

    const expiryMs = row.expires_at ? row.expires_at.getTime() : 0;
    const desired: XuiClientInput = {
      id: row.xray_uuid,
      email,
      flow: 'xtls-rprx-vision',
      limitIp: row.device_limit,
      totalGB: 0,
      expiryTime: expiryMs,
      enable: expiryMs > now().getTime(),
      tgId: userId,
      subId: '', // подписку отдаёт наш сервер, встроенная в панель не используется
      comment: 'Mraz1VPN',
      reset: 0,
    };
    const inboundIds = [t.visionInboundId, t.xhttpInboundId];

    if (!current) {
      await xui.addClient(desired, inboundIds);
    } else {
      const c = current.client;
      const same =
        c.uuid === desired.id &&
        c.enable === desired.enable &&
        c.expiryTime === desired.expiryTime &&
        c.limitIp === desired.limitIp &&
        c.flow === desired.flow;
      if (!same) await xui.updateClient(email, desired);
      const missing = inboundIds.filter((id) => !current.inboundIds.includes(id));
      if (missing.length) await xui.attachClient(email, missing);
    }

    await dbs.system.updateTable('vpn_keys').set({ panel_synced_at: sql<Date>`now()` }).where('id', '=', row.key_id).execute();
  }

  async function syncUserSafe(userId: number) {
    try {
      await syncUser(userId);
    } catch (e) {
      // Ключ уже выдан в базе; в панель его донесёт сверка. Юзер увидит ссылку сразу.
      log.warn({ err: (e as Error).message, userId }, 'vpn: панель не обновлена, догонит сверка');
    }
  }

  /**
   * Сверка базы и панели. full=false — только то, что менялось после последней синхронизации
   * (и истёкшие подписки); full=true — все юзеры с подпиской (лечит ручные правки и потерю базы панели).
   */
  async function reconcile(opts: { full: boolean }): Promise<{ checked: number; failed: number }> {
    // Срок вышел — статус expired. Сам доступ отключает и панель по expiryTime.
    await dbs.system
      .updateTable('subscriptions')
      .set({ status: 'expired', updated_at: sql<Date>`now()` })
      .where('status', 'in', ['trial', 'active'])
      .where('expires_at', '<=', sql<Date>`now()`)
      .execute();

    let q = dbs.system
      .selectFrom('subscriptions as s')
      .innerJoin('vpn_keys as k', (j) => j.onRef('k.subscription_id', '=', 's.id').on('k.revoked_at', 'is', null))
      .select('s.user_id')
      .where('s.status', '<>', 'archived');
    if (!opts.full) {
      q = q.where((eb) => eb.or([eb('k.panel_synced_at', 'is', null), eb('k.panel_synced_at', '<', eb.ref('s.updated_at'))]));
    }
    const users = await q.execute();

    let failed = 0;
    for (const { user_id } of users) {
      try {
        await syncUser(user_id);
      } catch (e) {
        failed++;
        log.warn({ err: (e as Error).message, userId: user_id }, 'vpn: сверка не удалась');
      }
    }
    return { checked: users.length, failed };
  }

  return { getSummary, startTrial, rotateKey, syncUser, reconcile };
}

function toInput(s: NonNullable<Awaited<ReturnType<XuiApi['getClient']>>>): XuiClientInput {
  const c = s.client;
  return {
    id: c.uuid,
    email: c.email,
    flow: c.flow,
    limitIp: c.limitIp,
    totalGB: 0,
    expiryTime: c.expiryTime,
    enable: c.enable,
    tgId: 0,
    subId: '',
    comment: 'Mraz1VPN',
    reset: 0,
  };
}

export type VpnService = ReturnType<typeof createVpnService>;

/** Ключ по токену ссылки — для /sub/<token>. Без контекста юзера, поэтому только системной ролью. */
export async function findKeyByToken(dbs: Databases, token: string) {
  if (!SUB_TOKEN_RE.test(token)) return undefined;
  return dbs.system
    .selectFrom('vpn_keys as k')
    .innerJoin('subscriptions as s', 's.id', 'k.subscription_id')
    .select(['k.user_id', 'k.xray_uuid', 'k.revoked_at', 's.status', 's.expires_at'])
    .where('k.sub_token', '=', token)
    .executeTakeFirst();
}
