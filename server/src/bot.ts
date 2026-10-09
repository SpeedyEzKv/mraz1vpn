import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bot, InlineKeyboard, InputFile, type Context } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import type { Config } from './config.js';
import { PLANS } from './payments/plans.js';
import { plural } from './text.js';
import type { VpnSummary } from './vpn/service.js';

const days = (n: number) => `${n} ${plural(n, 'день', 'дня', 'дней')}`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const dateFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long' });

type BotConfig = Pick<Config, 'botToken' | 'webAppUrl' | 'trialDays' | 'deviceLimit' | 'supportUsername'> &
  Partial<Pick<Config, 'privacyUrl' | 'termsUrl'>>;

export interface WelcomeInput {
  vpn: VpnSummary | null; // null — не удалось узнать (база недоступна): показываем общий текст
  providers: string[]; // доступные способы оплаты
  trialDays: number;
  deviceLimit: number;
}

/** Самая низкая цена за месяц среди тарифов (для строки «от … ₽/мес»). */
export const minMonthlyRub = () => Math.min(...PLANS.map((p) => Math.round(p.priceKop / p.months / 100)));

/** Текст приветствия (HTML). Только правда о сервисе: одна страна, лимит устройств из настроек. */
export function welcomeText(w: WelcomeInput): string {
  const pay = [
    w.providers.includes('yookassa') ? 'картой и по СБП' : null,
    w.providers.includes('cryptobot') ? 'криптовалютой' : null,
  ].filter(Boolean);

  const lines = [
    '<b>Mraz1VPN — быстрый и стабильный VPN</b>',
    '',
    '🌍 Сервер в Нидерландах, протокол VLESS Reality — работает там, где другие режут',
    '♾ Без ограничений по скорости и трафику, без рекламы',
    `📱 До ${w.deviceLimit} ${plural(w.deviceLimit, 'устройства', 'устройств', 'устройств')} одновременно: iPhone, Android, Windows, Mac`,
    '⚡️ Подключение в одну кнопку через Happ, v2RayTun или Hiddify',
  ];
  if (pay.length) lines.push(`💳 Оплата ${pay.join(' или ')}, от ${minMonthlyRub()} ₽ в месяц`);
  lines.push('');

  const v = w.vpn;
  if (v && (v.status === 'trial' || v.status === 'active') && v.expiresAt) {
    const what = v.status === 'trial' ? 'Пробный период действует' : 'Подписка действует';
    lines.push(`<b>${what} до ${esc(dateFmt.format(new Date(v.expiresAt)))}.</b> Продлить можно по кнопке ниже.`);
  } else if (v && v.status === 'expired') {
    lines.push('<b>Подписка закончилась.</b> Продлите — ссылка на ваших устройствах останется прежней.');
  } else if (!v || v.trialAvailable) {
    lines.push(`<b>Попробуйте ${days(w.trialDays)} бесплатно по кнопке ниже 👇</b>`);
  } else {
    lines.push('<b>Оформите подписку по кнопке ниже 👇</b>');
  }
  return lines.join('\n');
}

/** Ссылка на кабинет с нужным экраном: кабинет читает ?screen= при открытии. */
export const cabinetUrl = (base: string, screen?: 'plans' | 'connect' | 'trial') => {
  if (!screen) return base;
  const u = new URL(base);
  u.searchParams.set('screen', screen);
  return u.toString();
};

export function welcomeKeyboard(cfg: Pick<BotConfig, 'webAppUrl' | 'trialDays'>, vpn: VpnSummary | null) {
  const kb = new InlineKeyboard();
  const trial = !vpn || vpn.trialAvailable;
  if (trial) kb.webApp(`🎁 ${days(cfg.trialDays)} бесплатно`, cabinetUrl(cfg.webAppUrl, 'trial')).row();
  const hasSub = vpn && vpn.status !== 'none';
  kb.webApp(hasSub ? '💳 Продлить подписку' : '💳 Оформить подписку', cabinetUrl(cfg.webAppUrl, 'plans')).row();
  kb.webApp('👤 Личный кабинет', cfg.webAppUrl).row();
  kb.webApp('❓ Как подключить VPN', cabinetUrl(cfg.webAppUrl, 'connect')).row();
  kb.text('🛟 Поддержка', CB.support).row();
  return kb;
}

/* ---------- Поддержка: подменю с документами ---------- */
export const CB = { support: 'support', docs: 'support:docs', back: 'support:back', close: 'support:close' } as const;

export const SUPPORT_TEXT = '🛟 <b>Техническая поддержка</b>\n\nОтветим на вопросы по подключению, оплате и работе VPN.';
export const DOCS_TEXT = '📄 <b>Документы</b>\n\nПравила сервиса и обработка персональных данных.';

export function supportKeyboard(cfg: Pick<BotConfig, 'supportUsername'>) {
  const kb = new InlineKeyboard();
  if (cfg.supportUsername) kb.url('💬 Написать в поддержку', `https://t.me/${cfg.supportUsername}`).row();
  kb.text('📄 Документы', CB.docs).row();
  kb.text('↩️ Назад', CB.close);
  return kb;
}

export function docsKeyboard(cfg: Pick<BotConfig, 'privacyUrl' | 'termsUrl'>) {
  const kb = new InlineKeyboard();
  if (cfg.termsUrl) kb.url('📜 Пользовательское соглашение', cfg.termsUrl).row();
  if (cfg.privacyUrl) kb.url('🔒 Политика конфиденциальности', cfg.privacyUrl).row();
  kb.text('↩️ Назад', CB.back);
  return kb;
}

const BANNER_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'welcome.jpg');

export function createBot(
  config: BotConfig,
  deps: {
    getSummary?: (userId: number) => Promise<VpnSummary>;
    providers?: () => string[];
    // /start ref_XXXX: привязать нового юзера к пригласившему.
    registerReferral?: (user: { id: number; username?: string; first_name?: string; last_name?: string; language_code?: string }, payload: string) => Promise<boolean>;
    botInfo?: UserFromGetMe; // для тестов: без запроса getMe к Telegram
  } = {},
) {
  const bot = new Bot(config.botToken, deps.botInfo ? { botInfo: deps.botInfo } : undefined);

  const cabinetKeyboard = () => new InlineKeyboard().webApp('Открыть кабинет', config.webAppUrl);

  // Баннер загружаем в Telegram один раз, дальше отправляем по file_id — быстрее и без лишнего трафика.
  let bannerFileId: string | null = null;
  let banner: Buffer | null = null;
  try {
    banner = readFileSync(BANNER_PATH);
  } catch {
    banner = null; // нет файла — приветствие уйдёт без картинки
  }

  bot.command('start', async (ctx) => {
    if (ctx.from && ctx.match && deps.registerReferral) {
      try {
        await deps.registerReferral(ctx.from, ctx.match);
      } catch (e) {
        console.error('start: реферал не записан', (e as Error).message);
      }
    }
    let vpn: VpnSummary | null = null;
    if (ctx.from && deps.getSummary) {
      try {
        vpn = await deps.getSummary(ctx.from.id);
      } catch (e) {
        console.error('start: сводка недоступна', (e as Error).message);
      }
    }
    const text = welcomeText({
      vpn,
      providers: deps.providers?.() ?? [],
      trialDays: config.trialDays,
      deviceLimit: config.deviceLimit,
    });
    const reply_markup = welcomeKeyboard(config, vpn);

    if (!banner && !bannerFileId) return ctx.reply(text, { parse_mode: 'HTML', reply_markup });
    const msg = await ctx.replyWithPhoto(bannerFileId ?? new InputFile(banner!, 'welcome.jpg'), {
      caption: text,
      parse_mode: 'HTML',
      reply_markup,
    });
    bannerFileId ??= msg.photo.at(-1)?.file_id ?? null;
  });

  const sendSupport = (ctx: Context) =>
    ctx.reply(SUPPORT_TEXT, { parse_mode: 'HTML', reply_markup: supportKeyboard(config) });

  bot.command('support', (ctx) => sendSupport(ctx));

  // Кнопки подменю. Сообщение поддержки редактируется на месте: Поддержка ⇄ Документы.
  bot.callbackQuery(CB.support, async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendSupport(ctx);
  });
  bot.callbackQuery(CB.docs, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(DOCS_TEXT, { parse_mode: 'HTML', reply_markup: docsKeyboard(config) });
  });
  bot.callbackQuery(CB.back, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(SUPPORT_TEXT, { parse_mode: 'HTML', reply_markup: supportKeyboard(config) });
  });
  bot.callbackQuery(CB.close, async (ctx) => {
    await ctx.answerCallbackQuery();
    // «Назад» из поддержки: убираем подменю, главное меню остаётся выше.
    await ctx.deleteMessage().catch(() => ctx.editMessageReplyMarkup({ reply_markup: undefined }));
  });

  // На любое другое сообщение — короткая подсказка с кнопками.
  bot.on('message', (ctx) =>
    ctx.reply('Всё управление — в кабинете. Вопрос по работе VPN — в техподдержку.', {
      reply_markup: welcomeKeyboard(config, null).toFlowed(2),
    }),
  );

  bot.catch((err) => console.error('bot error', err.error));

  /** Кнопка меню слева от поля ввода и команды. Вызывается при старте сервера. */
  async function setupProfile() {
    await bot.api.setMyCommands([
      { command: 'start', description: 'Главное меню' },
      { command: 'support', description: 'Поддержка и документы' },
    ]);
    await bot.api.setChatMenuButton({
      menu_button: { type: 'web_app', text: 'Кабинет', web_app: { url: config.webAppUrl } },
    });
  }

  /** Сообщение юзеру с кнопкой кабинета (напоминания, подтверждение оплаты). */
  const notifier = {
    async send(userId: number, text: string) {
      await bot.api.sendMessage(userId, text, { reply_markup: cabinetKeyboard() });
    },
  };

  return { bot, setupProfile, notifier };
}
