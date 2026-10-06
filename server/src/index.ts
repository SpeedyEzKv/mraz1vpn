import { webhookCallback } from 'grammy';
import { createBot } from './bot.js';
import { loadConfig } from './config.js';
import { createDatabases } from './db/db.js';
import { buildApp } from './http.js';

const config = loadConfig();
const dbs = createDatabases(config.appDatabaseUrl, config.systemDatabaseUrl);
const app = buildApp(config, dbs, { logger: true });
const { bot, setupProfile } = createBot(config);

if (config.botMode === 'webhook') {
  // Telegram присылает secret_token в заголовке — чужие запросы на этот адрес отклоняются.
  const handle = webhookCallback(bot, 'fastify', { secretToken: config.botWebhookSecret });
  app.post('/bot/webhook', handle);
}

await app.listen({ host: '0.0.0.0', port: config.port });

try {
  await bot.init();
  await setupProfile();
  if (config.botMode === 'webhook') {
    await bot.api.setWebhook(`https://${config.domain}/bot/webhook`, {
      secret_token: config.botWebhookSecret,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
    });
    app.log.info('bot: webhook set');
  } else {
    await bot.api.deleteWebhook();
    void bot.start({ allowed_updates: ['message', 'callback_query'] });
    app.log.info('bot: polling');
  }
} catch (e) {
  // Сервер продолжает работать: mini app и API не зависят от того, достучались ли мы до Telegram.
  app.log.error(e, 'bot setup failed');
}

async function shutdown() {
  if (config.botMode === 'polling') await bot.stop();
  await app.close();
  await dbs.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
