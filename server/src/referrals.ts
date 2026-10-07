// Реферальная программа: ссылка-приглашение и привязка друга.
//
// Друг привязывается, только если он впервые пришёл в бота по ссылке (его ещё нет в базе).
// Бонус пригласившему начисляется при первой оплате друга (см. payments/service.ts) —
// за пробный период ничего не даём, иначе бонус легко накрутить.

import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import type { Databases } from './db/db.js';

const newCode = () => randomBytes(6).toString('base64url'); // 8 символов
export const REF_PAYLOAD_RE = /^ref_([A-Za-z0-9_-]{8})$/;

export interface ReferralInfo {
  link: string;
  bonusDays: number;
  invited: number;
  paid: number;
  daysEarned: number;
}

export function createReferrals(deps: { dbs: Databases; botUsername: string; bonusDays: number }) {
  const { dbs } = deps;

  /** Код юзера: создаётся при первом запросе. Пишет сервер (mraz_system), userId — из сессии. */
  async function ensureCode(userId: number): Promise<string> {
    for (let i = 0; i < 3; i++) {
      try {
        const row = await dbs.system
          .updateTable('users')
          .set({ ref_code: sql<string>`coalesce(ref_code, ${newCode()})` })
          .where('id', '=', userId)
          .returning('ref_code')
          .executeTakeFirst();
        if (!row?.ref_code) throw new Error('referrals: юзер не найден');
        return row.ref_code;
      } catch (e) {
        // Совпадение случайного кода (unique) — пробуем другой.
        if ((e as { code?: string }).code !== '23505') throw e;
      }
    }
    throw new Error('referrals: не удалось выдать код');
  }

  async function getInfo(userId: number): Promise<ReferralInfo> {
    const code = await ensureCode(userId);
    // Счётчики по чужим строкам users — только системной ролью, но строго по userId из сессии.
    const invited = await dbs.system
      .selectFrom('users')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('referred_by', '=', userId)
      .executeTakeFirstOrThrow();
    const rewards = await dbs.asUser(userId, (tx) =>
      tx
        .selectFrom('referral_rewards')
        .select((eb) => [eb.fn.countAll<string>().as('n'), eb.fn.coalesce(eb.fn.sum<string>('days'), sql<string>`0`).as('days')])
        .executeTakeFirstOrThrow(),
    );
    return {
      link: `https://t.me/${deps.botUsername}?start=ref_${code}`,
      bonusDays: deps.bonusDays,
      invited: Number(invited.n),
      paid: Number(rewards.n),
      daysEarned: Number(rewards.days),
    };
  }

  /**
   * /start ref_XXXX от нового юзера: создаём его строку с referred_by.
   * Уже знакомый юзер, неизвестный код или своя же ссылка — ничего не делаем.
   */
  async function registerFromStart(
    user: { id: number; username?: string; first_name?: string; last_name?: string; language_code?: string },
    payload: string,
  ): Promise<boolean> {
    const m = REF_PAYLOAD_RE.exec(payload);
    if (!m) return false;
    const referrer = await dbs.system.selectFrom('users').select('id').where('ref_code', '=', m[1]!).executeTakeFirst();
    if (!referrer || referrer.id === user.id) return false;
    const inserted = await dbs.system
      .insertInto('users')
      .values({
        id: user.id,
        username: user.username ?? null,
        first_name: user.first_name ?? null,
        last_name: user.last_name ?? null,
        language_code: user.language_code ?? null,
        trial_used_at: null,
        referred_by: referrer.id,
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .returning('id')
      .executeTakeFirst();
    return Boolean(inserted);
  }

  return { getInfo, registerFromStart, ensureCode };
}

export type Referrals = ReturnType<typeof createReferrals>;
