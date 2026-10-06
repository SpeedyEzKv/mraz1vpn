import { Bot, InlineKeyboard } from 'grammy';
import type { Config } from './config.js';

const START_TEXT = [
  'Mraz1VPN — VPN, который просто работает.',
  '',
  'В кабинете можно подключиться, посмотреть срок подписки и продлить её.',
].join('\n');

export function createBot(config: Config) {
  const bot = new Bot(config.botToken);

  const cabinetKeyboard = () => new InlineKeyboard().webApp('Открыть кабинет', config.webAppUrl);

  bot.command('start', (ctx) => ctx.reply(START_TEXT, { reply_markup: cabinetKeyboard() }));

  // На любое другое сообщение — та же подсказка, без лишних слов.
  bot.on('message', (ctx) => ctx.reply('Всё управление — в кабинете.', { reply_markup: cabinetKeyboard() }));

  bot.catch((err) => console.error('bot error', err.error));

  /** Кнопка меню слева от поля ввода и команды. Вызывается при старте сервера. */
  async function setupProfile() {
    await bot.api.setMyCommands([{ command: 'start', description: 'Открыть кабинет' }]);
    await bot.api.setChatMenuButton({
      menu_button: { type: 'web_app', text: 'Кабинет', web_app: { url: config.webAppUrl } },
    });
  }

  return { bot, setupProfile };
}
