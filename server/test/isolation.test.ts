// Изоляция данных юзеров. Запускать на пустой тестовой Postgres:
//   TEST_ADMIN_DATABASE_URL=postgres://postgres:pass@127.0.0.1:5432/postgres npm test
//
// Проверяем три уровня:
//  1) каждая таблица в public под принудительным RLS и имеет политику;
//  2) роль приложения напрямую в SQL не видит и не меняет чужие строки;
//  3) через HTTP юзер А не достаёт данные юзера Б даже подделанными запросами.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { sql } from 'kysely';
import { signInitDataForTest } from '../src/auth/initData.js';
import { issueSession } from '../src/auth/session.js';
import { createDatabases, type Databases } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { buildApp } from '../src/http.js';

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5433/postgres';
const BOT_TOKEN = '123456:TEST';
const SECRET = randomBytes(32).toString('hex');
const A = 1001;
const B = 2002;

const dbName = `mraz_test_${randomBytes(4).toString('hex')}`;
const withDb = (url: string, db: string, user?: string, password?: string) => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  if (user) u.username = user;
  if (password) u.password = password;
  return u.toString();
};

let dbs: Databases;
let app: ReturnType<typeof buildApp>;
let admin: pg.Client;

before(async () => {
  const root = new pg.Client({ connectionString: ADMIN_URL });
  await root.connect();
  await root.query(`CREATE DATABASE ${dbName}`);
  await root.end();

  const testAdminUrl = withDb(ADMIN_URL, dbName);
  await migrate(testAdminUrl, 'app-pass', 'system-pass');

  admin = new pg.Client({ connectionString: testAdminUrl });
  await admin.connect();
  await admin.query(`INSERT INTO users(id, first_name) VALUES (${A}, 'A'), (${B}, 'B')`);
  await admin.query(`INSERT INTO subscriptions(user_id, status) VALUES (${A}, 'trial'), (${B}, 'active')`);
  await admin.query(`INSERT INTO vpn_keys(user_id, subscription_id, sub_token)
    SELECT user_id, id, 'tok-' || user_id FROM subscriptions`);

  dbs = createDatabases(
    withDb(ADMIN_URL, dbName, 'mraz_app', 'app-pass'),
    withDb(ADMIN_URL, dbName, 'mraz_system', 'system-pass'),
  );
  app = buildApp(
    {
      botToken: BOT_TOKEN,
      sessionSecret: SECRET,
      sessionTtlSec: 3600,
      initDataMaxAgeSec: 86400,
      adminIds: new Set([A]),
      botUsername: 'test_bot',
    },
    dbs,
  );
  await app.ready();
});

after(async () => {
  await app?.close();
  await dbs?.close();
  await admin?.end();
  const root = new pg.Client({ connectionString: ADMIN_URL });
  await root.connect();
  await root.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await root.end();
});

const tokenFor = (uid: number) => issueSession(uid, SECRET, 3600).token;
const get = (url: string, token?: string) =>
  app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });

describe('1. схема', () => {
  test('каждая таблица в public: RLS включён, FORCE, есть политика', async () => {
    const { rows } = await admin.query<{ relname: string; rls: boolean; force: boolean; policies: number }>(`
      SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
             (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`);
    assert.ok(rows.length >= 3);
    for (const r of rows) {
      assert.ok(r.rls && r.force && r.policies > 0, `таблица ${r.relname} без изоляции`);
    }
  });

  test('роль приложения не обходит RLS и не владеет таблицами', async () => {
    const { rows } = await admin.query(`
      SELECT r.rolbypassrls, r.rolsuper,
             (SELECT count(*)::int FROM pg_class c WHERE c.relowner = r.oid) AS owned
      FROM pg_roles r WHERE r.rolname = 'mraz_app'`);
    assert.deepEqual(rows[0], { rolbypassrls: false, rolsuper: false, owned: 0 });
  });
});

describe('2. SQL под ролью приложения', () => {
  test('A видит только свои подписки и ключи', async () => {
    const res = await dbs.asUser(A, async (tx) => ({
      subs: await tx.selectFrom('subscriptions').select('user_id').execute(),
      keys: await tx.selectFrom('vpn_keys').select(['user_id', 'sub_token']).execute(),
      users: await tx.selectFrom('users').select('id').execute(),
    }));
    assert.deepEqual(res.subs.map((r) => r.user_id), [A]);
    assert.deepEqual(res.keys, [{ user_id: A, sub_token: `tok-${A}` }]);
    assert.deepEqual(res.users.map((r) => r.id), [A]);
  });

  test('A явно запрашивает строки B — пусто', async () => {
    const rows = await dbs.asUser(A, (tx) =>
      tx.selectFrom('vpn_keys').selectAll().where('user_id', '=', B).execute(),
    );
    assert.equal(rows.length, 0);
  });

  test('A не может переписать профиль B', async () => {
    await dbs.asUser(A, (tx) => tx.updateTable('users').set({ first_name: 'hacked' }).where('id', '=', B).execute());
    const { rows } = await admin.query(`SELECT first_name FROM users WHERE id = ${B}`);
    assert.equal(rows[0].first_name, 'B');
  });

  test('A не может создать строку от имени B', async () => {
    await assert.rejects(
      dbs.asUser(A, (tx) => tx.insertInto('users').values({ id: 3003 } as never).execute()),
      /row-level security/,
    );
  });

  test('A не может менять и удалять подписки и ключи', async () => {
    await assert.rejects(
      dbs.asUser(A, (tx) => tx.updateTable('subscriptions').set({ status: 'active' }).execute()),
      /permission denied/,
    );
    await assert.rejects(dbs.asUser(A, (tx) => tx.deleteFrom('vpn_keys').execute()), /permission denied/);
  });

  test('подмена app.user_id внутри транзакции не даёт чужих данных через API-путь', async () => {
    // asUser всегда ставит id из сессии; проверяем, что без контекста роль не видит ничего.
    const none = await dbs.asUser(A, async (tx) => {
      await sql`SELECT set_config('app.user_id', '', true)`.execute(tx);
      return tx.selectFrom('subscriptions').selectAll().execute();
    });
    assert.equal(none.length, 0);
  });

  test('контекст юзера не протекает в пул соединений', async () => {
    await dbs.asUser(A, (tx) => tx.selectFrom('users').select('id').execute());
    const leaked = await dbs.asUser(B, (tx) => tx.selectFrom('subscriptions').select('user_id').execute());
    assert.deepEqual(leaked.map((r) => r.user_id), [B]);
  });
});

describe('3. HTTP', () => {
  test('без сессии — 401', async () => {
    assert.equal((await get('/api/subscriptions')).statusCode, 401);
    assert.equal((await get('/api/me')).statusCode, 401);
  });

  test('A получает только свои подписки и ключи', async () => {
    const subs = (await get('/api/subscriptions', tokenFor(A))).json();
    const keys = (await get('/api/keys', tokenFor(A))).json();
    assert.deepEqual(subs.items.map((s: { user_id: number }) => s.user_id), [A]);
    assert.deepEqual(keys.items.map((k: { user_id: number }) => k.user_id), [A]);
  });

  test('параметры в запросе игнорируются: ?user_id=B не помогает', async () => {
    const res = (await get(`/api/subscriptions?user_id=${B}&id=${B}`, tokenFor(A))).json();
    assert.deepEqual(res.items.map((s: { user_id: number }) => s.user_id), [A]);
  });

  test('сессия, подписанная чужим секретом, — 401', async () => {
    const forged = issueSession(B, 'f'.repeat(64), 3600).token;
    assert.equal((await get('/api/subscriptions', forged)).statusCode, 401);
  });

  test('подмена uid в сессии A — 401', async () => {
    const [, sig] = tokenFor(A).split('.');
    const body = Buffer.from(JSON.stringify({ uid: B, exp: 9_999_999_999 })).toString('base64url');
    assert.equal((await get('/api/subscriptions', `${body}.${sig}`)).statusCode, 401);
  });

  test('вход по initData: подпись верна — сессия, isAdmin из конфига сервера', async () => {
    const initData = signInitDataForTest(
      { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: A, first_name: 'A' }) },
      BOT_TOKEN,
    );
    const login = await app.inject({ method: 'POST', url: '/api/auth/telegram', payload: { initData } });
    assert.equal(login.statusCode, 200);
    const me = (await get('/api/me', login.json().token)).json();
    assert.equal(me.id, A);
    assert.equal(me.isAdmin, true);
  });

  test('вход по initData, подписанному не нашим ботом, — 401', async () => {
    const initData = signInitDataForTest(
      { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: B }) },
      '999:not-our-bot',
    );
    const login = await app.inject({ method: 'POST', url: '/api/auth/telegram', payload: { initData } });
    assert.equal(login.statusCode, 401);
  });

  test('B не админ, даже если попросит', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/me?isAdmin=true',
      headers: { authorization: `Bearer ${tokenFor(B)}`, 'x-admin': '1' },
    });
    assert.equal(res.json().isAdmin, false);
  });
});
