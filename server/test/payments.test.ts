// Оплата: создание, подтверждение (вебхук и сверка), продление ровно один раз, подделки, напоминания.
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import Fastify from 'fastify';
import { issueSession } from '../src/auth/session.js';
import { buildApp } from '../src/http.js';
import { createCryptoBot, type CryptoBotApi, type CryptoInvoice } from '../src/payments/cryptobot.js';
import { createPaymentService } from '../src/payments/service.js';
import { createYooKassa, type YooKassaApi, type YooPayment } from '../src/payments/yookassa.js';
import { sendReminders } from '../src/reminders.js';
import { createTestDb } from './helpers.js';

const SECRET = randomBytes(32).toString('hex');
const CB_TOKEN = '12345:AAtesttoken';
const A = 6001;
const B = 6002;
const C = 6003;

let t: Awaited<ReturnType<typeof createTestDb>>;
let app: ReturnType<typeof buildApp>;
let service: ReturnType<typeof createPaymentService>;

// Фейковая ЮKassa: хранит платежи, статус меняет тест.
const yoo = new Map<string, YooPayment>();
const yooCreates: unknown[] = [];
const fakeYoo: YooKassaApi = {
  async createPayment(i) {
    yooCreates.push(i);
    const p: YooPayment = {
      id: `2f${randomBytes(8).toString('hex')}-000f-5000-8000-1b2c3d4e5f60`,
      status: 'pending',
      paid: false,
      amount: { value: i.amountRub, currency: 'RUB' },
      confirmation: { type: 'redirect', confirmation_url: 'https://yoomoney.ru/checkout/payments/v2/contract?orderId=x' },
      metadata: i.metadata,
    };
    yoo.set(p.id, p);
    return p;
  },
  async getPayment(id) {
    const p = yoo.get(id);
    if (!p) throw new Error('not found');
    return structuredClone(p);
  },
};

const invoices = new Map<number, CryptoInvoice>();
let nextInvoice = 900;
const fakeCb: CryptoBotApi = {
  async createInvoice(i) {
    const inv: CryptoInvoice = {
      invoice_id: nextInvoice++,
      status: 'active',
      currency_type: 'fiat',
      fiat: 'RUB',
      amount: i.amountRub,
      bot_invoice_url: 'https://t.me/CryptoBot?start=IVabc',
      payload: i.payload,
    };
    invoices.set(inv.invoice_id, inv);
    return inv;
  },
  async getInvoices(ids) {
    return ids.map((id) => invoices.get(id)).filter((x): x is CryptoInvoice => !!x);
  },
};

const synced: number[] = [];
const messages: { userId: number; text: string }[] = [];
const notifier = {
  async send(userId: number, text: string) {
    messages.push({ userId, text });
  },
};

before(async () => {
  t = await createTestDb();
  await t.admin.query(`INSERT INTO users(id) VALUES (${A}), (${B}), (${C})`);
  service = createPaymentService({
    dbs: t.dbs,
    yookassa: fakeYoo,
    cryptobot: fakeCb,
    domain: 'mraz1vpn.ru',
    botUsername: 'mraz1vpn_bot',
    deviceLimit: 3,
    onSubscriptionChanged: async (uid) => void synced.push(uid),
    notifier,
    log: { info() {}, warn() {}, error() {} },
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
    { payments: { service, cryptobotToken: CB_TOKEN } },
  );
  await app.ready();
});

after(async () => {
  await app?.close();
  await t?.drop();
});

beforeEach(() => {
  synced.length = 0;
  messages.length = 0;
});

const auth = (uid: number) => ({ authorization: `Bearer ${issueSession(uid, SECRET, 3600).token}` });
const pay = (uid: number, plan: string, provider: string) =>
  app.inject({ method: 'POST', url: '/api/payments', headers: auth(uid), payload: { plan, provider } });
const sub = async (uid: number) =>
  (await t.admin.query(`SELECT status, expires_at FROM subscriptions WHERE user_id = ${uid} AND status <> 'archived'`)).rows[0] as
    | { status: string; expires_at: Date }
    | undefined;
const daysFromNow = (d: Date) => (d.getTime() - Date.now()) / 864e5;
const yooWebhook = (id: string) =>
  app.inject({ method: 'POST', url: '/pay/yookassa', payload: { type: 'notification', event: 'payment.succeeded', object: { id } } });
const cbSign = (body: string) => createHmac('sha256', createHash('sha256').update(CB_TOKEN).digest()).update(body).digest('hex');
const cbWebhook = (inv: CryptoInvoice, signature?: string) => {
  const body = JSON.stringify({ update_id: 1, update_type: 'invoice_paid', request_date: new Date().toISOString(), payload: inv });
  return app.inject({
    method: 'POST',
    url: '/pay/cryptobot',
    headers: { 'content-type': 'application/json', 'crypto-pay-api-signature': signature ?? cbSign(body) },
    payload: body,
  });
};
const succeedYoo = (id: string) => {
  const p = yoo.get(id)!;
  p.status = 'succeeded';
  p.paid = true;
  p.captured_at = new Date().toISOString();
};

describe('тарифы', () => {
  test('четыре тарифа с ценами и оба способа оплаты', async () => {
    const r = (await app.inject({ method: 'GET', url: '/api/plans', headers: auth(A) })).json();
    assert.deepEqual(r.providers, ['yookassa', 'cryptobot']);
    assert.deepEqual(
      r.plans.map((p: { id: string; priceRub: number; days: number }) => [p.id, p.priceRub, p.days]),
      [
        ['m1', 100, 30],
        ['m3', 249, 90],
        ['m6', 449, 180],
        ['y1', 799, 365],
      ],
    );
    assert.deepEqual(r.plans.map((p: { discountPct: number }) => p.discountPct), [0, 17, 25, 33]);
  });

  test('без сессии — 401, неизвестный тариф или способ — 400', async () => {
    assert.equal((await app.inject({ method: 'POST', url: '/api/payments', payload: { plan: 'm1', provider: 'yookassa' } })).statusCode, 401);
    assert.deepEqual((await pay(A, 'free', 'yookassa')).json(), { error: 'bad_plan' });
    assert.deepEqual((await pay(A, 'm1', 'paypal')).json(), { error: 'provider_unavailable' });
  });
});

describe('ЮKassa', () => {
  test('создание: сумма, описание для чека, возврат на /paid, ключ идемпотентности', async () => {
    const res = await pay(A, 'm3', 'yookassa');
    assert.equal(res.statusCode, 200);
    const r = res.json();
    assert.match(r.url, /^https:\/\/yoomoney\.ru\//);
    const req = yooCreates.at(-1) as Record<string, unknown>;
    assert.equal(req.amountRub, '249.00');
    assert.equal(req.description, 'Доступ к VPN-сервису Mraz1VPN на 3 месяца');
    assert.equal(req.returnUrl, 'https://mraz1vpn.ru/paid');
    assert.equal(req.idempotenceKey, `mraz1vpn-payment-${r.id}`);
    assert.equal((await app.inject({ method: 'GET', url: `/api/payments/${r.id}`, headers: auth(A) })).json().status, 'pending');
  });

  test('вебхук без реальной оплаты (платёж в ЮKassa ещё pending) — ничего не продлевает', async () => {
    const r = (await pay(A, 'm1', 'yookassa')).json();
    const { rows } = await t.admin.query(`SELECT provider_payment_id FROM payments WHERE id = ${r.id}`);
    const res = await yooWebhook(rows[0].provider_payment_id);
    assert.equal(res.statusCode, 200);
    assert.equal(await sub(A), undefined);
  });

  test('оплачено: подписка на 30 дней, ключ, синхронизация с панелью, сообщение в боте', async () => {
    const r = (await pay(A, 'm1', 'yookassa')).json();
    const pid = (await t.admin.query(`SELECT provider_payment_id FROM payments WHERE id = ${r.id}`)).rows[0].provider_payment_id;
    succeedYoo(pid);
    await yooWebhook(pid);

    const s = await sub(A);
    assert.equal(s?.status, 'active');
    assert.ok(Math.abs(daysFromNow(s!.expires_at) - 30) < 0.01);
    const keys = await t.admin.query(`SELECT count(*)::int AS n FROM vpn_keys WHERE user_id = ${A} AND revoked_at IS NULL`);
    assert.equal(keys.rows[0].n, 1);
    assert.deepEqual(synced, [A]);
    assert.equal(messages.length, 1);
    assert.match(messages[0]!.text, /^Оплата прошла\. Подписка действует до /);
    assert.equal((await app.inject({ method: 'GET', url: `/api/payments/${r.id}`, headers: auth(A) })).json().status, 'succeeded');

    // Повторный вебхук и сверка — без второго продления.
    await yooWebhook(pid);
    await service.pollPending();
    assert.equal((await sub(A))!.expires_at.getTime(), s!.expires_at.getTime());
    assert.equal(messages.length, 1);
  });

  test('продление идёт от конца текущей подписки, а не от сегодня', async () => {
    const before = (await sub(A))!.expires_at;
    const r = (await pay(A, 'm3', 'yookassa')).json();
    const pid = (await t.admin.query(`SELECT provider_payment_id FROM payments WHERE id = ${r.id}`)).rows[0].provider_payment_id;
    succeedYoo(pid);
    await yooWebhook(pid);
    const after = (await sub(A))!.expires_at;
    assert.equal(Math.round((after.getTime() - before.getTime()) / 864e5), 90);
  });

  test('сумма в ЮKassa не совпала с тарифом — не продлеваем', async () => {
    const r = (await pay(B, 'y1', 'yookassa')).json();
    const pid = (await t.admin.query(`SELECT provider_payment_id FROM payments WHERE id = ${r.id}`)).rows[0].provider_payment_id;
    succeedYoo(pid);
    yoo.get(pid)!.amount.value = '1.00';
    await yooWebhook(pid);
    assert.equal(await sub(B), undefined);
  });

  test('потерянный вебхук: оплату подхватывает сверка', async () => {
    const r = (await pay(C, 'm1', 'yookassa')).json();
    const pid = (await t.admin.query(`SELECT provider_payment_id FROM payments WHERE id = ${r.id}`)).rows[0].provider_payment_id;
    succeedYoo(pid);
    await service.pollPending();
    assert.equal((await sub(C))?.status, 'active');
  });

  test('мусорный вебхук — 200 и ничего не происходит', async () => {
    for (const payload of [{}, { object: { id: '../../admin' } }, { object: { id: 'x'.repeat(10) } }]) {
      const res = await app.inject({ method: 'POST', url: '/pay/yookassa', payload });
      assert.ok([200, 500].includes(res.statusCode));
    }
  });
});

describe('CryptoBot', () => {
  test('создание: счёт в рублях на сумму тарифа, ссылка на оплату в Telegram', async () => {
    const r = (await pay(B, 'm6', 'cryptobot')).json();
    assert.equal(r.url, 'https://t.me/CryptoBot?start=IVabc');
    const inv = [...invoices.values()].at(-1)!;
    assert.equal(inv.amount, '449.00');
    assert.equal(inv.payload, String(r.id));
  });

  test('вебхук с чужой подписью — 401, ничего не продлено', async () => {
    const inv = [...invoices.values()].at(-1)!;
    const res = await cbWebhook({ ...inv, status: 'paid' }, 'a'.repeat(64));
    assert.equal(res.statusCode, 401);
    assert.equal(await sub(B), undefined);
  });

  test('подписанный вебхук, но в CryptoBot сумма другая — не продлеваем', async () => {
    const inv = [...invoices.values()].at(-1)!;
    const res = await cbWebhook({ ...inv, status: 'paid', amount: '1.00' });
    assert.equal(res.statusCode, 200);
    assert.equal(await sub(B), undefined);
  });

  test('оплачено: подписка на 180 дней; повтор вебхука ничего не добавляет', async () => {
    const inv = [...invoices.values()].at(-1)!;
    inv.status = 'paid';
    inv.paid_at = new Date().toISOString();
    assert.equal((await cbWebhook(inv)).statusCode, 200);
    const s = await sub(B);
    assert.equal(s?.status, 'active');
    assert.ok(Math.abs(daysFromNow(s!.expires_at) - 180) < 0.01);
    await cbWebhook(inv);
    assert.equal((await sub(B))!.expires_at.getTime(), s!.expires_at.getTime());
  });

  test('после пробного периода оставшиеся дни пробника сохраняются', async () => {
    await t.admin.query(`INSERT INTO users(id) VALUES (6010)`);
    await t.admin.query(`INSERT INTO subscriptions(user_id, status, expires_at) VALUES (6010, 'trial', now() + interval '2 days')`);
    const r = (await pay(6010, 'm1', 'cryptobot')).json();
    const inv = [...invoices.values()].find((i) => i.payload === String(r.id))!;
    inv.status = 'paid';
    await cbWebhook(inv);
    const s = await sub(6010);
    assert.equal(s?.status, 'active');
    assert.ok(Math.abs(daysFromNow(s!.expires_at) - 32) < 0.01);
  });

  test('истёкшая подписка продлевается от сегодня', async () => {
    await t.admin.query(`INSERT INTO users(id) VALUES (6011)`);
    await t.admin.query(`INSERT INTO subscriptions(user_id, status, expires_at) VALUES (6011, 'expired', now() - interval '10 days')`);
    const r = (await pay(6011, 'm1', 'cryptobot')).json();
    const inv = [...invoices.values()].find((i) => i.payload === String(r.id))!;
    inv.status = 'paid';
    await service.pollPending();
    assert.ok(Math.abs(daysFromNow((await sub(6011))!.expires_at) - 30) < 0.01);
  });
});

describe('изоляция и защита', () => {
  test('чужой платёж не виден: 404', async () => {
    const r = (await pay(A, 'm1', 'yookassa')).json();
    assert.equal((await app.inject({ method: 'GET', url: `/api/payments/${r.id}`, headers: auth(B) })).statusCode, 404);
  });

  test('приложение не может само отметить платёж оплаченным', async () => {
    await assert.rejects(
      t.dbs.asUser(A, (tx) => tx.updateTable('payments').set({ status: 'succeeded' }).execute()),
      /permission denied/,
    );
  });

  test('больше 10 неоплаченных за час — 429', async () => {
    await t.admin.query(`INSERT INTO users(id) VALUES (6020)`);
    const codes = [];
    for (let i = 0; i < 11; i++) codes.push((await pay(6020, 'm1', 'yookassa')).statusCode);
    assert.deepEqual(codes.slice(-2), [200, 429]);
  });
});

describe('напоминания', () => {
  test('за 3 дня, за 1 день и по окончании — по одному разу; пробнику за 3 дня не пишем', async () => {
    await t.admin.query(`INSERT INTO users(id) VALUES (6030), (6031), (6032), (6033)`);
    await t.admin.query(`INSERT INTO subscriptions(user_id, status, expires_at) VALUES
      (6030, 'active', now() + interval '2 days 12 hours'),
      (6031, 'active', now() + interval '20 hours'),
      (6032, 'expired', now() - interval '3 hours'),
      (6033, 'trial', now() + interval '2 days 12 hours')`);
    const silent = { info() {}, warn() {}, error() {} };

    await sendReminders(t.dbs, notifier, silent);
    const to = (uid: number) => messages.filter((m) => m.userId === uid).map((m) => m.text);
    assert.match(to(6030)[0]!, /закончится через 3 дня/);
    assert.match(to(6031)[0]!, /закончится завтра/);
    assert.match(to(6032)[0]!, /закончилась, VPN отключён/);
    assert.deepEqual(to(6033), []);

    const n = messages.length;
    await sendReminders(t.dbs, notifier, silent);
    assert.equal(messages.length, n, 'повторно не шлём');

    // Продлили — срок новый; когда снова подойдёт к концу, напомним опять.
    await t.admin.query(`UPDATE subscriptions SET expires_at = expires_at + interval '1 minute' WHERE user_id = 6031`);
    await sendReminders(t.dbs, notifier, silent);
    assert.equal(to(6031).length, 2);
  });
});

describe('HTTP-клиенты провайдеров (формат запросов)', () => {
  let mock: ReturnType<typeof Fastify>;
  let base = '';
  const seen: { url: string; headers: Record<string, unknown>; body: unknown }[] = [];

  before(async () => {
    mock = Fastify();
    mock.post('/v3/payments', async (req) => {
      seen.push({ url: req.url, headers: req.headers, body: req.body });
      return { id: 'p1', status: 'pending', paid: false, amount: { value: '100.00', currency: 'RUB' }, confirmation: { type: 'redirect', confirmation_url: 'https://pay' } };
    });
    mock.get('/v3/payments/:id', async (req) => {
      seen.push({ url: req.url, headers: req.headers, body: null });
      return { id: 'p1', status: 'succeeded', paid: true, amount: { value: '100.00', currency: 'RUB' } };
    });
    mock.post('/api/createInvoice', async (req) => {
      seen.push({ url: req.url, headers: req.headers, body: req.body });
      return { ok: true, result: { invoice_id: 1, status: 'active', currency_type: 'fiat', fiat: 'RUB', amount: '100', bot_invoice_url: 'https://t.me/CryptoBot?start=x' } };
    });
    mock.post('/api/getInvoices', async (req) => {
      seen.push({ url: req.url, headers: req.headers, body: req.body });
      return { ok: false, error: { code: 401, name: 'UNAUTHORIZED' } };
    });
    base = await mock.listen({ port: 0, host: '127.0.0.1' });
  });
  after(() => mock.close());

  test('ЮKassa: Basic-авторизация, Idempotence-Key, capture, redirect', async () => {
    const yk = createYooKassa('123456', 'live_secret', `${base}/v3`);
    await yk.createPayment({ amountRub: '100.00', description: 'd', returnUrl: 'https://mraz1vpn.ru/paid', idempotenceKey: 'k1', metadata: { payment_id: '1' } });
    const r = seen.at(-1)!;
    assert.equal(r.headers.authorization, 'Basic ' + Buffer.from('123456:live_secret').toString('base64'));
    assert.equal(r.headers['idempotence-key'], 'k1');
    assert.deepEqual(r.body, {
      amount: { value: '100.00', currency: 'RUB' },
      capture: true,
      confirmation: { type: 'redirect', return_url: 'https://mraz1vpn.ru/paid' },
      description: 'd',
      metadata: { payment_id: '1' },
    });
    assert.equal((await yk.getPayment('p1')).status, 'succeeded');
  });

  test('CryptoBot: токен в заголовке, счёт в RUB, ошибка API — исключение', async () => {
    const cb = createCryptoBot('tok', false, `${base}/api`);
    await cb.createInvoice({ amountRub: '100.00', description: 'd', payload: '7', expiresInSec: 3600, paidBtnUrl: 'https://t.me/mraz1vpn_bot' });
    const r = seen.at(-1)!;
    assert.equal(r.headers['crypto-pay-api-token'], 'tok');
    const b = r.body as Record<string, unknown>;
    assert.equal(b.currency_type, 'fiat');
    assert.equal(b.fiat, 'RUB');
    assert.equal(b.amount, '100.00');
    assert.equal(b.paid_btn_name, 'openBot');
    await assert.rejects(cb.getInvoices([1]), /UNAUTHORIZED/);
  });
});
