// Приветствие бота: текст, кнопки, картинка. Telegram подменён — смотрим, что бот отправил бы.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cabinetUrl, createBot, welcomeKeyboard, welcomeText } from '../src/bot.js';
import type { VpnSummary } from '../src/vpn/service.js';

const cfg = {
  botToken: '1:x',
  webAppUrl: 'https://mraz1vpn.online/',
  trialDays: 3,
  deviceLimit: 3,
  supportUsername: 'mraz_support',
};
const summary = (s: Partial<VpnSummary>): VpnSummary => ({
  status: 'none',
  expiresAt: null,
  trialAvailable: true,
  trialDays: 3,
  deviceLimit: 3,
  subscriptionUrl: null,
  ...s,
});
type Btn = { text: string; url?: string; web_app?: { url: string } };
const buttons = (kb: ReturnType<typeof welcomeKeyboard>) => (kb.inline_keyboard.flat() as Btn[]).map((b) => [b.text, b.url ?? b.web_app?.url]);

test('новичок: пробный период, оформить, кабинет, подключение, поддержка', () => {
  assert.deepEqual(buttons(welcomeKeyboard(cfg, summary({}))), [
    ['🎁 3 дня бесплатно', 'https://mraz1vpn.online/?screen=trial'],
    ['💳 Оформить подписку', 'https://mraz1vpn.online/?screen=plans'],
    ['👤 Личный кабинет', 'https://mraz1vpn.online/'],
    ['❓ Как подключить VPN', 'https://mraz1vpn.online/?screen=connect'],
    ['🛟 Техподдержка', 'https://t.me/mraz_support'],
  ]);
  assert.match(welcomeText({ vpn: summary({}), providers: ['cryptobot'], trialDays: 3, deviceLimit: 3 }), /Попробуйте 3 дня бесплатно/);
});

test('с подпиской: «Продлить подписку», без пробного, в тексте срок', () => {
  const v = summary({ status: 'active', trialAvailable: false, expiresAt: '2027-01-07T15:00:00Z' });
  const b = buttons(welcomeKeyboard(cfg, v)).map((x) => x[0]);
  assert.equal(b[0], '💳 Продлить подписку');
  assert.ok(!b.some((t) => t!.includes('бесплатно')));
  assert.match(welcomeText({ vpn: v, providers: [], trialDays: 3, deviceLimit: 3 }), /Подписка действует до 7 января/);
});

test('способы оплаты в тексте — только подключённые; цена от минимальной за месяц', () => {
  const crypto = welcomeText({ vpn: null, providers: ['cryptobot'], trialDays: 3, deviceLimit: 3 });
  assert.match(crypto, /Оплата криптовалютой, от 67 ₽ в месяц/);
  assert.doesNotMatch(crypto, /СБП/);
  const both = welcomeText({ vpn: null, providers: ['yookassa', 'cryptobot'], trialDays: 3, deviceLimit: 3 });
  assert.match(both, /картой и по СБП или криптовалютой/);
  assert.doesNotMatch(welcomeText({ vpn: null, providers: [], trialDays: 3, deviceLimit: 3 }), /Оплата/);
});

test('без username поддержки кнопки поддержки нет', () => {
  const b = buttons(welcomeKeyboard({ ...cfg, supportUsername: '' }, null)).map((x) => x[0]);
  assert.ok(!b.includes('🛟 Техподдержка'));
});

test('cabinetUrl сохраняет путь и добавляет screen', () => {
  assert.equal(cabinetUrl('https://mraz1vpn.online/', 'plans'), 'https://mraz1vpn.online/?screen=plans');
});

test('/start: фото-баннер с подписью и кнопками; второй раз — по file_id', async () => {
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  const { bot } = createBot(cfg, {
    getSummary: async () => summary({}),
    providers: () => ['cryptobot'],
    botInfo: {
      id: 1, is_bot: true, first_name: 'Mraz1VPN', username: 'mraz1vpn_bot',
      can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false,
      can_connect_to_business: false, has_main_web_app: false,
    } as never,
  });
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    const result = method === 'sendPhoto' ? { message_id: 1, date: 0, chat: { id: 5, type: 'private' }, photo: [{ file_id: 'FILE123', file_unique_id: 'u', width: 1280, height: 720 }] } : true;
    return { ok: true, result } as never;
  });
  const start = (id: number) =>
    bot.handleUpdate({
      update_id: id,
      message: {
        message_id: id, date: 0, chat: { id: 5, type: 'private', first_name: 'A' },
        from: { id: 5, is_bot: false, first_name: 'A' }, text: '/start',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }],
      },
    } as never);

  await start(1);
  await start(2);
  assert.deepEqual(calls.map((c) => c.method), ['sendPhoto', 'sendPhoto']);
  const first = calls[0]!.payload;
  assert.equal(first.parse_mode, 'HTML');
  assert.match(String(first.caption), /<b>Mraz1VPN — быстрый и стабильный VPN<\/b>/);
  assert.ok(typeof first.photo === 'object', 'первый раз — загрузка файла');
  assert.equal(calls[1]!.payload.photo, 'FILE123', 'второй раз — по file_id');
  const kb = (first.reply_markup as { inline_keyboard: Btn[][] }).inline_keyboard.flat();
  assert.equal(kb.length, 5);
});
