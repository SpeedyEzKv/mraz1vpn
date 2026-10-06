import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { verifyInitData } from './auth/initData.js';
import { issueSession, readSession } from './auth/session.js';
import type { Config } from './config.js';
import type { Databases } from './db/db.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: number;
  }
}

type AppConfig = Pick<
  Config,
  'botToken' | 'sessionSecret' | 'sessionTtlSec' | 'initDataMaxAgeSec' | 'adminIds' | 'botUsername'
>;

export function buildApp(config: AppConfig, dbs: Databases, opts: { logger?: boolean } = {}) {
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
  app.get('/api/public-config', async () => ({ botUsername: config.botUsername }));

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

    scope.get('/api/keys', async (req) => {
      const rows = await dbs.asUser(req.userId, (tx) =>
        tx.selectFrom('vpn_keys').select(['id', 'user_id', 'subscription_id', 'revoked_at']).orderBy('id').execute(),
      );
      return { items: rows };
    });
  });

  return app;
}
