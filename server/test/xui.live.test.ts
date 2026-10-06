// Проверка на настоящей панели 3x-ui. В CI пропускается; локально:
//   XUI_TEST_URL=http://127.0.0.1:2053/<путь>/ XUI_TEST_TOKEN=<токен> npm test
// Панель должна быть пустой тестовой: тест создаёт inbound'ы и клиентов.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createVpnService, panelEmail } from '../src/vpn/service.js';
import { createTopologyCache } from '../src/vpn/topology.js';
import { createXuiClient } from '../src/xui/client.js';
import { createTestDb } from './helpers.js';

const URL_ = process.env.XUI_TEST_URL;
const TOKEN = process.env.XUI_TEST_TOKEN;
const skip = !URL_ || !TOKEN ? 'нет XUI_TEST_URL / XUI_TEST_TOKEN' : false;

describe('живая панель 3x-ui', { skip }, () => {
  const U = 7000 + Math.floor(Math.random() * 1000);
  let t: Awaited<ReturnType<typeof createTestDb>>;
  const xui = createXuiClient(URL_ ?? '', TOKEN ?? '');
  const cfg = { serverName: 'mraz1vpn.ru', realityTarget: '127.0.0.1:8443', vpnPort: 443, xhttpPort: 10443 };
  const topology = createTopologyCache(xui, cfg);
  let service: ReturnType<typeof createVpnService>;

  before(async () => {
    t = await createTestDb();
    await t.admin.query(`INSERT INTO users(id) VALUES (${U})`);
    service = createVpnService({
      dbs: t.dbs,
      config: { trialDays: 3, deviceLimit: 3, subscriptionBaseUrl: 'https://mraz1vpn.ru/sub/' },
      xui,
      topology: topology.get,
      log: { info() {}, warn: console.warn, error: console.error },
    });
  });
  after(async () => {
    await t?.drop();
  });

  test('inbound’ы создаются один раз, fallback на XHTTP с PROXY protocol', async () => {
    const a = await topology.refresh();
    const b = await topology.refresh();
    assert.deepEqual(a, b);
    const list = await xui.listInbounds();
    assert.equal(list.filter((i) => i.tag === 'mraz-vision').length, 1);
    assert.equal(list.filter((i) => i.tag === 'mraz-xhttp').length, 1);
  });

  test('пробный период создаёт клиента на обоих inbound’ах', async () => {
    await service.startTrial(U);
    const c = await xui.getClient(panelEmail(U));
    assert.ok(c);
    const tp = await topology.get();
    assert.deepEqual([...c.inboundIds].sort(), [tp.visionInboundId, tp.xhttpInboundId].sort());
    assert.equal(c.client.enable, true);
    assert.equal(c.client.limitIp, 3);
    const { rows } = await t.admin.query(`SELECT xray_uuid, expires_at FROM vpn_keys k JOIN subscriptions s ON s.id = k.subscription_id WHERE k.user_id = ${U}`);
    assert.equal(c.client.uuid, rows[0].xray_uuid);
    assert.equal(c.client.expiryTime, new Date(rows[0].expires_at).getTime());
  });

  test('перевыпуск меняет UUID у того же клиента', async () => {
    const before = (await xui.getClient(panelEmail(U)))!.client.uuid;
    await service.rotateKey(U);
    const after = (await xui.getClient(panelEmail(U)))!;
    assert.notEqual(after.client.uuid, before);
    const { rows } = await t.admin.query(`SELECT xray_uuid FROM vpn_keys WHERE user_id = ${U} AND revoked_at IS NULL`);
    assert.equal(after.client.uuid, rows[0].xray_uuid);
    assert.equal(after.inboundIds.length, 2);
  });

  test('срок вышел — сверка выключает клиента; продление — включает', async () => {
    await t.admin.query(`UPDATE subscriptions SET expires_at = now() - interval '1 minute', updated_at = now() WHERE user_id = ${U}`);
    await service.reconcile({ full: false });
    assert.equal((await xui.getClient(panelEmail(U)))!.client.enable, false);

    await t.admin.query(`UPDATE subscriptions SET status = 'active', expires_at = now() + interval '30 days', updated_at = now() WHERE user_id = ${U}`);
    const r = await service.reconcile({ full: false });
    assert.equal(r.failed, 0);
    const c = (await xui.getClient(panelEmail(U)))!;
    assert.equal(c.client.enable, true);
    assert.ok(c.client.expiryTime > Date.now() + 29 * 864e5);
  });
});
