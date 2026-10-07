// Реферальная программа: привязка по /start ref_XXXX, бонус за первую оплату друга, защита от накрутки.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { issueSession } from '../src/auth/session.js';
import { buildApp } from '../src/http.js';
import { createPaymentService } from '../src/payments/service.js';
import type { CryptoBotApi, CryptoInvoice } from '../src/payments/cryptobot.js';
import { createReferrals } from '../src/referrals.js';
import { createTestDb } from './helpers.js';

const SECRET = randomBytes(32).toString('hex');
const R = 8001; // пригласивший
const F = 8002; // друг
const G = 8003; // второй друг, только пробный период
const OLD = 8004; // уже был в боте до ссылки

let t: Awaited<ReturnType<typeof createTestDb>>;
let referrals: ReturnType<typeof createReferrals>;
let payments: ReturnType<typeof createPaymentService>;
let app: ReturnType<typeof buildApp>;
const messages: { userId: number; text: string }[] = [];
const synced: number[] = [];

const invoices = new Map<number, CryptoInvoice>();
let next = 1;
const cb: CryptoBotApi = {
  async createInvoice(i) {
    const inv: CryptoInvoice = { invoice_id: next++, status: 'active', currency_type: 'fiat', fiat: 'RUB', amount: i.amountRub, bot_invoice_url: 'https://t.me/CryptoBot?start=x', payload: i.payload };
    invoices.set(inv.invoice_id, inv);
    return inv;
  },
  async getInvoices(ids) {
    return ids.map((id) => invoices.get(id)!).filter(Boolean);
  },
};

before(async () => {
  t = await createTestDb();
  await t.admin.query(`INSERT INTO users(id, first_name) VALUES (${R}, 'R'), (${OLD}, 'Old')`);
  referrals = createReferrals({ dbs: t.dbs, botUsername: 'mraz1vpn_bot', bonusDays: 7 });
  payments = createPaymentService({
    dbs: t.dbs,
    yookassa: null,
    cryptobot: cb,
    domain: 'mraz1vpn.online',
    botUsername: 'mraz1vpn_bot',
    deviceLimit: 3,
    referralBonusDays: 7,
    onSubscriptionChanged: async (uid) => void synced.push(uid),
    notifier: { send: async (userId, text) => void messages.push({ userId, text }) },
    log: { info() {}, warn() {}, error() {} },
  });
  app = buildApp(
    { botToken: '1:x', sessionSecret: SECRET, sessionTtlSec: 3600, initDataMaxAgeSec: 86400, adminIds: new Set(), botUsername: 'mraz1vpn_bot' },
    t.dbs,
    { referrals, payments: { service: payments, cryptobotToken: 'tok' } },
  );
  await app.ready();
});

after(async () => {
  await app?.close();
  await t?.drop();
});

const auth = (uid: number) => ({ authorization: `Bearer ${issueSession(uid, SECRET, 3600).token}` });
const info = async (uid: number) => (await app.inject({ method: 'GET', url: '/api/referrals', headers: auth(uid) })).json();
const codeOf = (link: string) => link.split('start=')[1]!;
const pay = async (uid: number, plan: string) => {
  const r = (await app.inject({ method: 'POST', url: '/api/payments', headers: auth(uid), payload: { plan, provider: 'cryptobot' } })).json();
  const inv = [...invoices.values()].find((i) => i.payload === String(r.id))!;
  inv.status = 'paid';
  await payments.pollPending();
};
const expires = async (uid: number) =>
  (await t.admin.query(`SELECT status, expires_at FROM subscriptions WHERE user_id = ${uid} AND status <> 'archived'`)).rows[0] as
    | { status: string; expires_at: Date }
    | undefined;

describe('ссылка и привязка', () => {
  test('у юзера появляется ссылка с постоянным случайным кодом', async () => {
    const a = await info(R);
    assert.match(a.link, /^https:\/\/t\.me\/mraz1vpn_bot\?start=ref_[A-Za-z0-9_-]{8}$/);
    assert.equal((await info(R)).link, a.link, 'код не меняется');
    assert.doesNotMatch(a.link, new RegExp(String(R)), 'Telegram ID в ссылке не светится');
    assert.deepEqual({ ...a, link: '' }, { link: '', bonusDays: 7, invited: 0, paid: 0, daysEarned: 0 });
  });

  test('новый юзер по ссылке привязывается; старый, по своей ссылке и по мусору — нет', async () => {
    const code = codeOf((await info(R)).link);
    assert.equal(await referrals.registerFromStart({ id: F, first_name: 'F' }, code), true);
    assert.equal(await referrals.registerFromStart({ id: G, first_name: 'G' }, code), true);
    assert.equal(await referrals.registerFromStart({ id: OLD }, code), false, 'уже был в боте');
    assert.equal(await referrals.registerFromStart({ id: R }, code), false, 'своя ссылка');
    assert.equal(await referrals.registerFromStart({ id: 8099 }, 'ref_AAAAAAAA'), false, 'неизвестный код');
    assert.equal(await referrals.registerFromStart({ id: 8098 }, 'промо'), false);
    const { rows } = await t.admin.query(`SELECT id, referred_by FROM users WHERE id IN (${F}, ${G}, ${OLD}) ORDER BY id`);
    assert.deepEqual(rows.map((r) => [Number(r.id), r.referred_by && Number(r.referred_by)]), [[F, R], [G, R], [OLD, null]]);
    assert.equal((await info(R)).invited, 2);
  });

  test('приложение (mraz_app) не может само себе прописать пригласившего или код', async () => {
    await assert.rejects(
      t.dbs.asUser(OLD, (tx) => tx.updateTable('users').set({ referred_by: R }).where('id', '=', OLD).execute()),
      /permission denied/,
    );
    await assert.rejects(
      t.dbs.asUser(OLD, (tx) => tx.updateTable('users').set({ ref_code: 'XXXXXXXX' }).where('id', '=', OLD).execute()),
      /permission denied/,
    );
  });
});

describe('бонус', () => {
  test('первая оплата друга: другу 30 дней, пригласившему +7 (подписки не было — создаётся), сообщение', async () => {
    await pay(F, 'm1');
    const r = await expires(R);
    assert.equal(r?.status, 'active');
    assert.ok(Math.abs((r!.expires_at.getTime() - Date.now()) / 864e5 - 7) < 0.01);
    assert.ok(synced.includes(R));
    assert.match(messages.find((m) => m.userId === R)!.text, /друг оформил подписку — вам \+7 дней/);
    assert.deepEqual({ ...(await info(R)), link: '' }, { link: '', bonusDays: 7, invited: 2, paid: 1, daysEarned: 7 });
    const key = await t.admin.query(`SELECT count(*)::int AS n FROM vpn_keys WHERE user_id = ${R} AND revoked_at IS NULL`);
    assert.equal(key.rows[0].n, 1, 'у пригласившего появился ключ');
  });

  test('вторая оплата того же друга бонуса не даёт', async () => {
    const before = (await expires(R))!.expires_at.getTime();
    await pay(F, 'm3');
    assert.equal((await expires(R))!.expires_at.getTime(), before);
    assert.equal((await info(R)).paid, 1);
  });

  test('пробный период друга бонуса не даёт', async () => {
    await t.admin.query(`INSERT INTO subscriptions(user_id, status, expires_at) VALUES (${G}, 'trial', now() + interval '3 days')`);
    assert.equal((await info(R)).paid, 1);
  });

  test('бонус к пробному периоду пригласившего: дни добавляются, статус остаётся «пробный»', async () => {
    // Пригласивший G-2: на пробном, приглашает H, H платит.
    await t.admin.query(`INSERT INTO users(id) VALUES (8010)`);
    await t.admin.query(`INSERT INTO subscriptions(user_id, status, expires_at) VALUES (8010, 'trial', now() + interval '2 days')`);
    const code = codeOf((await info(8010)).link);
    await referrals.registerFromStart({ id: 8011 }, code);
    await pay(8011, 'm1');
    const s = await expires(8010);
    assert.equal(s?.status, 'trial');
    assert.ok(Math.abs((s!.expires_at.getTime() - Date.now()) / 864e5 - 9) < 0.01);
  });

  test('чужая статистика не видна: у друга своя ссылка и нули', async () => {
    const f = await info(F);
    assert.notEqual(f.link, (await info(R)).link);
    assert.equal(f.paid, 0);
    assert.equal(f.invited, 0);
  });
});
