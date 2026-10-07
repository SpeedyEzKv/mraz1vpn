// Выдача ключей: пробный период, ссылка подписки, перевыпуск, сверка с панелью.
// Панель 3x-ui здесь — фейк в памяти; на живой панели проверяет test/xui.live.test.ts.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { PgBoss } from 'pg-boss';
import { issueSession } from '../src/auth/session.js';
import { buildApp } from '../src/http.js';
import { createVpnService, panelEmail } from '../src/vpn/service.js';
import { createTopologyCache } from '../src/vpn/topology.js';
import { createTestDb, fakeXui } from './helpers.js';

const SECRET = randomBytes(32).toString('hex');
const A = 5001;
const B = 5002;
const C = 5003;

let t: Awaited<ReturnType<typeof createTestDb>>;
let xui: ReturnType<typeof fakeXui>;
let service: ReturnType<typeof createVpnService>;
let app: ReturnType<typeof buildApp>;
let clock = new Date();

const silent = { info() {}, warn() {}, error() {} };

before(async () => {
  t = await createTestDb();
  await t.admin.query(`INSERT INTO users(id, first_name) VALUES (${A}, 'A'), (${B}, 'B'), (${C}, 'C')`);
  xui = fakeXui();
  const topology = createTopologyCache(xui.api, {
    serverName: 'mraz1vpn.ru',
    realityTarget: 'caddy:8443',
    xrayPort: 443,
    acceptProxyProtocol: false,
    xhttpPort: 10443,
  });
  service = createVpnService({
    dbs: t.dbs,
    config: { trialDays: 3, deviceLimit: 3, subscriptionBaseUrl: 'https://mraz1vpn.ru/sub/' },
    xui: xui.api,
    topology: topology.get,
    log: silent,
    now: () => clock,
  });
  app = buildApp(
    {
      botToken: '1:x',
      sessionSecret: SECRET,
      sessionTtlSec: 3600,
      initDataMaxAgeSec: 86400,
      adminIds: new Set(),
      botUsername: 'mraz1vpn_bot',
    },
    t.dbs,
    { vpn: { service, topology: topology.get, endpoint: { host: 'mraz1vpn.ru', port: 443 } } },
  );
  await app.ready();
});

after(async () => {
  await app?.close();
  await t?.drop();
});

beforeEach(() => {
  clock = new Date();
  xui.setDown(false);
});

const auth = (uid: number) => ({ authorization: `Bearer ${issueSession(uid, SECRET, 3600).token}` });
const call = (method: 'GET' | 'POST', url: string, uid?: number) =>
  app.inject({ method, url, headers: uid ? auth(uid) : {} });
const tokenOf = (url: string) => url.split('/').pop()!;
const decode = (body: string) => Buffer.from(body, 'base64').toString('utf8').split('\n');

describe('пробный период', () => {
  test('новый юзер: подписки нет, пробный доступен', async () => {
    const r = (await call('GET', '/api/vpn', A)).json();
    assert.deepEqual(r, { status: 'none', expiresAt: null, trialAvailable: true, trialDays: 3, deviceLimit: 3, subscriptionUrl: null });
  });

  test('без сессии — 401', async () => {
    assert.equal((await call('POST', '/api/vpn/trial')).statusCode, 401);
  });

  test('запуск: подписка на 3 дня, ссылка, клиент в панели на обоих inbound’ах', async () => {
    const res = await call('POST', '/api/vpn/trial', A);
    assert.equal(res.statusCode, 200);
    const r = res.json();
    assert.equal(r.status, 'trial');
    assert.equal(r.trialAvailable, false);
    assert.match(r.subscriptionUrl, /^https:\/\/mraz1vpn\.ru\/sub\/[A-Za-z0-9_-]{32}$/);
    const days = (Date.parse(r.expiresAt) - Date.now()) / 864e5;
    assert.ok(days > 2.99 && days <= 3.01, `срок ${days} дн.`);

    const c = xui.clients.get(panelEmail(A));
    assert.ok(c, 'клиент создан в панели');
    assert.equal(c.client.limitIp, 3);
    assert.equal(c.client.enable, true);
    assert.equal(c.client.flow, 'xtls-rprx-vision');
    assert.equal(c.client.expiryTime, Date.parse(r.expiresAt));
    assert.deepEqual([...c.inboundIds].sort(), [1, 2]);
  });

  test('второй раз — 409 trial_used, подписка не меняется', async () => {
    const before = (await call('GET', '/api/vpn', A)).json();
    const res = await call('POST', '/api/vpn/trial', A);
    assert.equal(res.statusCode, 409);
    assert.deepEqual(res.json(), { error: 'trial_used' });
    assert.deepEqual((await call('GET', '/api/vpn', A)).json(), before);
  });

  test('параллельные запросы — ровно одна подписка', async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => call('POST', '/api/vpn/trial', C)));
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409, 409, 409, 409]);
    const { rows } = await t.admin.query(`SELECT count(*)::int AS n FROM subscriptions WHERE user_id = ${C}`);
    assert.equal(rows[0].n, 1);
  });

  test('панель недоступна: ключ всё равно выдан, сверка донесёт его до панели', async () => {
    xui.setDown(true);
    const r = (await call('POST', '/api/vpn/trial', B)).json();
    assert.equal(r.status, 'trial');
    assert.ok(r.subscriptionUrl);
    assert.equal(xui.clients.has(panelEmail(B)), false);

    xui.setDown(false);
    const rec = await service.reconcile({ full: false });
    assert.equal(rec.failed, 0);
    assert.equal(xui.clients.get(panelEmail(B))?.client.enable, true);

    // Повторная сверка ничего не трогает: всё синхронизировано.
    const n = xui.calls.length;
    assert.equal((await service.reconcile({ full: false })).checked, 0);
    assert.equal(xui.calls.length, n);
  });
});

describe('ссылка подписки /sub/<token>', () => {
  test('отдаёт две ссылки VLESS Reality с UUID юзера и заголовки для приложений', async () => {
    const { subscriptionUrl } = (await call('GET', '/api/vpn', A)).json();
    const res = await call('GET', `/sub/${tokenOf(subscriptionUrl)}`);
    assert.equal(res.statusCode, 200);
    const links = decode(res.body);
    assert.equal(links.length, 2);

    const uuid = xui.clients.get(panelEmail(A))!.client.uuid;
    const [vision, xhttp] = links.map((l) => new URL(l));
    assert.equal(vision!.username, uuid);
    assert.equal(vision!.host, 'mraz1vpn.ru:443');
    assert.equal(vision!.searchParams.get('security'), 'reality');
    assert.equal(vision!.searchParams.get('flow'), 'xtls-rprx-vision');
    assert.equal(vision!.searchParams.get('pbk'), 'PUBKEY');
    assert.equal(vision!.searchParams.get('sni'), 'mraz1vpn.ru');
    assert.equal(xhttp!.searchParams.get('type'), 'xhttp');
    assert.equal(xhttp!.searchParams.get('flow'), null);
    assert.match(xhttp!.searchParams.get('path')!, /^\/[0-9a-f]{16}$/);

    const expire = Number(/expire=(\d+)/.exec(String(res.headers['subscription-userinfo']))![1]);
    const { expiresAt } = (await call('GET', '/api/vpn', A)).json();
    assert.equal(expire, Math.floor(Date.parse(expiresAt) / 1000));
    assert.equal(res.headers['profile-title'], `base64:${Buffer.from('Mraz1VPN').toString('base64')}`);
    assert.equal(res.headers['cache-control'], 'no-store');
  });

  test('неизвестный или кривой токен — 404', async () => {
    assert.equal((await call('GET', `/sub/${'A'.repeat(32)}`)).statusCode, 404);
    assert.equal((await call('GET', '/sub/short')).statusCode, 404);
    assert.equal((await call('GET', `/sub/${"'; DROP TABLE users; --".padEnd(32, 'x')}`)).statusCode, 404);
  });

  test('подписка истекла: вместо ключей — табличка «продлите в боте», в панели клиент выключен', async () => {
    const { subscriptionUrl } = (await call('GET', '/api/vpn', B)).json();
    await t.admin.query(`UPDATE subscriptions SET expires_at = now() - interval '1 minute' WHERE user_id = ${B}`);

    const res = await call('GET', `/sub/${tokenOf(subscriptionUrl)}`);
    assert.equal(res.statusCode, 200);
    const links = decode(res.body);
    assert.equal(links.length, 1);
    assert.match(decodeURIComponent(links[0]!.split('#')[1]!), /Подписка закончилась — продлите в @mraz1vpn_bot/);
    assert.ok(!links[0]!.includes(xui.clients.get(panelEmail(B))!.client.uuid), 'настоящий UUID не утекает');

    assert.equal((await call('GET', '/api/vpn', B)).json().status, 'expired');
    await service.reconcile({ full: false });
    const { rows } = await t.admin.query(`SELECT status FROM subscriptions WHERE user_id = ${B}`);
    assert.equal(rows[0].status, 'expired');
    assert.equal(xui.clients.get(panelEmail(B))!.client.enable, false);
  });
});

describe('перевыпуск ссылки', () => {
  test('старая ссылка — 404, новая работает, UUID в панели сменился, клиент тот же', async () => {
    const before = (await call('GET', '/api/vpn', A)).json();
    const oldUuid = xui.clients.get(panelEmail(A))!.client.uuid;

    const res = await call('POST', '/api/vpn/rotate', A);
    assert.equal(res.statusCode, 200);
    const after = res.json();
    assert.notEqual(after.subscriptionUrl, before.subscriptionUrl);
    assert.equal(after.expiresAt, before.expiresAt, 'срок не меняется');

    assert.equal((await call('GET', `/sub/${tokenOf(before.subscriptionUrl)}`)).statusCode, 404);
    const fresh = await call('GET', `/sub/${tokenOf(after.subscriptionUrl)}`);
    assert.equal(fresh.statusCode, 200);

    const newUuid = xui.clients.get(panelEmail(A))!.client.uuid;
    assert.notEqual(newUuid, oldUuid);
    assert.ok(decode(fresh.body)[0]!.includes(newUuid));
    const { rows } = await t.admin.query(`SELECT count(*)::int AS n FROM vpn_keys WHERE user_id = ${A} AND revoked_at IS NULL`);
    assert.equal(rows[0].n, 1);
  });

  test('без подписки — 409 no_subscription', async () => {
    await t.admin.query(`INSERT INTO users(id) VALUES (5009)`);
    const res = await call('POST', '/api/vpn/rotate', 5009);
    assert.equal(res.statusCode, 409);
    assert.deepEqual(res.json(), { error: 'no_subscription' });
  });
});

describe('изоляция и права', () => {
  test('сводка юзера не видит чужую подписку (RLS)', async () => {
    const a = (await call('GET', '/api/vpn', A)).json();
    const c = (await call('GET', '/api/vpn', C)).json();
    assert.notEqual(a.subscriptionUrl, c.subscriptionUrl);
  });

  test('приложение (mraz_app) не может отметить себе пробный период «неиспользованным»', async () => {
    await assert.rejects(
      t.dbs.asUser(A, (tx) => tx.updateTable('users').set({ trial_used_at: null }).where('id', '=', A).execute()),
      /permission denied/,
    );
  });

  test('приложение не может выдать себе ключ или продлить подписку', async () => {
    await assert.rejects(
      t.dbs.asUser(A, (tx) =>
        tx.updateTable('subscriptions').set({ expires_at: new Date('2099-01-01') }).where('user_id', '=', A).execute(),
      ),
      /permission denied/,
    );
    await assert.rejects(
      t.dbs.asUser(A, (tx) =>
        tx.insertInto('vpn_keys').values({ user_id: A, subscription_id: 1, sub_token: 'x', revoked_at: null, panel_synced_at: null }).execute(),
      ),
      /permission denied/,
    );
  });
});

describe('очередь задач', () => {
  test('pg-boss запускается под mraz_system в своей схеме, без прав на создание схем', async () => {
    const boss = new PgBoss({ connectionString: t.systemUrl, schema: 'pgboss', createSchema: false, max: 1 });
    boss.on('error', () => {});
    await boss.start();
    await boss.createQueue('vpn-reconcile');
    await boss.schedule('vpn-reconcile', '*/5 * * * *');
    const id = await boss.send('vpn-reconcile', {});
    assert.ok(id);
    await boss.stop({ graceful: false });

    const { rows } = await t.admin.query(`SELECT has_database_privilege('mraz_system', current_database(), 'CREATE') AS c`);
    assert.equal(rows[0].c, false);
  });
});
