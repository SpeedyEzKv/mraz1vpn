import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { verifyInitData } from './auth/initData.js';
import { issueSession, readSession } from './auth/session.js';
import type { Config } from './config.js';
import type { Databases } from './db/db.js';
import { buildVlessLinks, placeholderLink, subscriptionResponse, type Endpoint } from './vpn/links.js';
import { findKeyByToken, VpnError, type VpnService } from './vpn/service.js';
import type { VpnTopology } from './xui/setup.js';
import { verifyCryptoBotSignature } from './payments/cryptobot.js';
import { PaymentError, type PaymentService } from './payments/service.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: number;
  }
}

type AppConfig = Pick<
  Config,
  'botToken' | 'sessionSecret' | 'sessionTtlSec' | 'initDataMaxAgeSec' | 'adminIds' | 'botUsername'
> & { supportUsername?: string };

export interface VpnDeps {
  service: VpnService;
  topology: () => Promise<VpnTopology>;
  endpoint: Endpoint;
}

export interface PaymentDeps {
  service: PaymentService;
  cryptobotToken: string | null;
}

export function buildApp(
  config: AppConfig,
  dbs: Databases,
  opts: { logger?: boolean; vpn?: VpnDeps; payments?: PaymentDeps } = {},
) {
  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 16 * 1024,
    trustProxy: true,
  });
  app.decorateRequest('userId', 0);

  // Ответы об ошибках без подробностей: клиент сам покажет спокойный текст.
  const deny = (reply: FastifyReply) => reply.code(401).send({ error: 'unauthorized' });

  async function requireSession(req: FastifyRequest, reply: FastifyReply) {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const uid = readSession(token, config.sessionSecret);
    if (!uid) return deny(reply);
    req.userId = uid;
  }

  app.get('/api/health', async () => ({ ok: true }));

  // Публичная конфигурация для клиента. Здесь только то, что и так видно всем.
  app.get('/api/public-config', async () => ({
    botUsername: config.botUsername,
    supportUsername: config.supportUsername || null,
  }));

  // Вход: initData → проверка подписи → upsert юзера → сессия.
  app.post<{ Body: { initData?: unknown } }>('/api/auth/telegram', async (req, reply) => {
    const result = verifyInitData(req.body?.initData, config.botToken, config.initDataMaxAgeSec);
    if (!result.ok) {
      req.log.info({ reason: result.reason }, 'auth rejected');
      return deny(reply);
    }
    const u = result.user;

    // Создание/обновление своей строки — тоже через RLS: юзер может записать только себя.
    await dbs.asUser(u.id, (tx) =>
      tx
        .insertInto('users')
        .values({
          id: u.id,
          username: u.username ?? null,
          first_name: u.first_name ?? null,
          last_name: u.last_name ?? null,
          language_code: u.language_code ?? null,
          is_premium: u.is_premium === true,
        })
        .onConflict((oc) =>
          oc.column('id').doUpdateSet((eb) => ({
            username: eb.ref('excluded.username'),
            first_name: eb.ref('excluded.first_name'),
            last_name: eb.ref('excluded.last_name'),
            language_code: eb.ref('excluded.language_code'),
            is_premium: eb.ref('excluded.is_premium'),
            last_seen_at: new Date(),
          })),
        )
        .execute(),
    );

    const session = issueSession(u.id, config.sessionSecret, config.sessionTtlSec);
    return { token: session.token, expiresAt: session.expiresAt };
  });

  const vpn = opts.vpn;
  const botUrl = `https://t.me/${config.botUsername}`;

  // Ссылка подписки для VPN-приложений. Без сессии: доступ даёт сам токен (192 бита случайности).
  // Отозванный или чужой токен — 404, без подсказок.
  if (vpn) {
    app.get<{ Params: { token: string } }>('/sub/:token', async (req, reply) => {
      const key = await findKeyByToken(dbs, req.params.token);
      if (!key || key.revoked_at) return reply.code(404).type('text/plain').send('not found');

      const alive = key.expires_at !== null && key.expires_at > new Date();
      let links: string[];
      if (alive) {
        try {
          links = buildVlessLinks(await vpn.topology(), vpn.endpoint, key.xray_uuid);
        } catch (e) {
          req.log.error({ err: (e as Error).message }, 'sub: нет параметров VPN');
          return reply.code(503).type('text/plain').send('temporarily unavailable');
        }
      } else {
        links = [placeholderLink(`Подписка закончилась — продлите в @${config.botUsername}`)];
      }
      const r = subscriptionResponse({ links, expiresAt: key.expires_at, title: 'Mraz1VPN', supportUrl: botUrl });
      return reply.headers(r.headers).send(r.body);
    });
  }

  const payments = opts.payments;
  if (payments) {
    // Вебхук ЮKassa. Телу не доверяем: сервис перезапросит платёж у ЮKassa по id.
    // Ошибка → 500, ЮKassa повторит уведомление позже.
    app.post('/pay/yookassa', async (req, reply) => {
      await payments.service.onYooKassaWebhook(req.body);
      return reply.code(200).send({ ok: true });
    });

    // Вебхук CryptoBot: подпись считается по сырому телу, поэтому JSON здесь не разбираем заранее.
    app.register(async (raw) => {
      raw.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
      raw.post('/pay/cryptobot', async (req, reply) => {
        const body = String(req.body ?? '');
        if (!payments.cryptobotToken || !verifyCryptoBotSignature(payments.cryptobotToken, body, req.headers['crypto-pay-api-signature'])) {
          req.log.warn('cryptobot: неверная подпись');
          return reply.code(401).send({ error: 'bad_signature' });
        }
        let update: unknown;
        try {
          update = JSON.parse(body);
        } catch {
          return reply.code(400).send({ error: 'bad_json' });
        }
        await payments.service.onCryptoBotWebhook(update);
        return reply.code(200).send({ ok: true });
      });
    });
  }

  // Всё ниже — только с сессией. userId берётся из подписанной сессии, не из запроса.
  app.register(async (scope) => {
    scope.addHook('preHandler', requireSession);

    scope.get('/api/me', async (req, reply) => {
      const user = await dbs.asUser(req.userId, (tx) =>
        tx.selectFrom('users').select(['id', 'username', 'first_name', 'last_name']).executeTakeFirst(),
      );
      if (!user) return deny(reply);
      return {
        id: user.id,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        isAdmin: config.adminIds.has(user.id),
      };
    });

    // Пока пусто. Нужен, чтобы проверить изоляцию до появления фич.
    scope.get('/api/subscriptions', async (req) => {
      const rows = await dbs.asUser(req.userId, (tx) =>
        tx.selectFrom('subscriptions').select(['id', 'user_id', 'status', 'expires_at']).orderBy('id').execute(),
      );
      return { items: rows };
    });

    if (vpn) {
      const vpnError = (reply: FastifyReply, e: unknown) => {
        if (e instanceof VpnError) return reply.code(409).send({ error: e.code });
        throw e;
      };

      scope.get('/api/vpn', async (req) => vpn.service.getSummary(req.userId));

      scope.post('/api/vpn/trial', async (req, reply) => {
        try {
          await vpn.service.startTrial(req.userId);
        } catch (e) {
          return vpnError(reply, e);
        }
        return vpn.service.getSummary(req.userId);
      });

      scope.post('/api/vpn/rotate', async (req, reply) => {
        try {
          await vpn.service.rotateKey(req.userId);
        } catch (e) {
          return vpnError(reply, e);
        }
        return vpn.service.getSummary(req.userId);
      });
    }

    if (payments) {
      scope.get('/api/plans', async () => payments.service.catalog());

      scope.post<{ Body: { plan?: unknown; provider?: unknown } }>('/api/payments', async (req, reply) => {
        try {
          return await payments.service.create(req.userId, req.body?.plan, req.body?.provider);
        } catch (e) {
          if (!(e instanceof PaymentError)) throw e;
          const code = e.code === 'too_many' ? 429 : e.code === 'provider_failed' ? 502 : 400;
          return reply.code(code).send({ error: e.code });
        }
      });

      scope.get<{ Params: { id: string } }>('/api/payments/:id', async (req, reply) => {
        const row = await payments.service.getStatus(req.userId, Number(req.params.id));
        if (!row) return reply.code(404).send({ error: 'not_found' });
        return row;
      });
    }

    scope.get('/api/keys', async (req) => {
      const rows = await dbs.asUser(req.userId, (tx) =>
        tx.selectFrom('vpn_keys').select(['id', 'user_id', 'subscription_id', 'revoked_at']).orderBy('id').execute(),
      );
      return { items: rows };
    });
  });

  return app;
}
