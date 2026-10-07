import { webhookCallback } from 'grammy';
import { PgBoss } from 'pg-boss';
import { createBot } from './bot.js';
import { loadConfig } from './config.js';
import { createDatabases } from './db/db.js';
import { buildApp } from './http.js';
import { createVpnService } from './vpn/service.js';
import { createTopologyCache } from './vpn/topology.js';
import { createXuiClient } from './xui/client.js';
import { createCryptoBot } from './payments/cryptobot.js';
import { createPaymentService } from './payments/service.js';
import { createYooKassa } from './payments/yookassa.js';
import { sendReminders } from './reminders.js';

const config = loadConfig();
const dbs = createDatabases(config.appDatabaseUrl, config.systemDatabaseUrl);

const xui = createXuiClient(config.xuiUrl, config.xuiApiToken);
const topology = createTopologyCache(xui, {
  serverName: config.realityServerName,
  realityTarget: config.realityTarget,
  xrayPort: config.xrayPort,
  acceptProxyProtocol: config.realityAcceptProxyProtocol,
  xhttpPort: config.xhttpPort,
});

// Логгер появится вместе с app; сервису он нужен позже, при первых запросах.
let log: Parameters<typeof createVpnService>[0]['log'] = console as never;
const vpnService = createVpnService({
  dbs,
  config: {
    trialDays: config.trialDays,
    deviceLimit: config.deviceLimit,
    subscriptionBaseUrl: `https://${config.domain}/sub/`,
  },
  xui,
  topology: topology.get,
  log: { info: (o, m) => log.info(o, m), warn: (o, m) => log.warn(o, m), error: (o, m) => log.error(o, m) },
});

const { bot, setupProfile, notifier } = createBot(config, {
  getSummary: (userId) => vpnService.getSummary(userId),
  providers: () => paymentService.catalog().providers,
});

const paymentService = createPaymentService({
  dbs,
  yookassa:
    config.yookassaShopId && config.yookassaSecretKey ? createYooKassa(config.yookassaShopId, config.yookassaSecretKey, config.yookassaApiUrl) : null,
  cryptobot: config.cryptobotToken ? createCryptoBot(config.cryptobotToken, config.cryptobotTestnet, config.cryptobotApiUrl) : null,
  domain: config.domain,
  botUsername: config.botUsername,
  deviceLimit: config.deviceLimit,
  onSubscriptionChanged: (userId) => vpnService.syncUser(userId),
  notifier,
  log: { info: (o, m) => log.info(o, m), warn: (o, m) => log.warn(o, m), error: (o, m) => log.error(o, m) },
});

const app = buildApp(config, dbs, {
  logger: true,
  vpn: { service: vpnService, topology: topology.get, endpoint: { host: config.vpnHost, port: config.vpnPort } },
  payments: { service: paymentService, cryptobotToken: config.cryptobotToken || null },
});
log = app.log;

if (config.botMode === 'webhook') {
  // Telegram присылает secret_token в заголовке — чужие запросы на этот адрес отклоняются.
  const handle = webhookCallback(bot, 'fastify', { secretToken: config.botWebhookSecret });
  app.post('/bot/webhook', handle);
}

await app.listen({ host: '0.0.0.0', port: config.port });

// Inbound'ы в панели: создаём при первом запуске. Панель может стартовать позже нас — не страшно,
// попробуем ещё раз при первом запросе и при каждой сверке.
topology.get().then(
  (t) => app.log.info({ vision: t.visionInboundId, xhttp: t.xhttpInboundId }, 'vpn: inbound’ы готовы'),
  (e) => app.log.warn({ err: (e as Error).message }, 'vpn: панель пока недоступна'),
);

// Фоновые задачи: сверка базы с панелью. Очередь — pg-boss в схеме pgboss, роль mraz_system.
const boss = new PgBoss({ connectionString: config.systemDatabaseUrl, schema: 'pgboss', createSchema: false, max: 2 });
boss.on('error', (e) => app.log.error({ err: e.message }, 'pg-boss'));
await boss.start();
for (const q of ['vpn-reconcile', 'vpn-reconcile-full', 'payments-poll', 'reminders']) await boss.createQueue(q);
await boss.schedule('vpn-reconcile', '*/5 * * * *');
await boss.schedule('vpn-reconcile-full', '17 */6 * * *');
await boss.work('vpn-reconcile', async () => {
  const r = await vpnService.reconcile({ full: false });
  if (r.checked) app.log.info(r, 'vpn: сверка');
});
await boss.schedule('payments-poll', '* * * * *');
await boss.schedule('reminders', '7 * * * *');
await boss.work('payments-poll', async () => {
  await paymentService.pollPending();
});
await boss.work('reminders', async () => {
  const r = await sendReminders(dbs, notifier, app.log);
  if (r.sent) app.log.info(r, 'reminders: отправлено');
});
await boss.work('vpn-reconcile-full', async () => {
  await topology.refresh();
  app.log.info(await vpnService.reconcile({ full: true }), 'vpn: полная сверка');
});

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
  await boss.stop({ graceful: true, timeout: 10_000 });
  await app.close();
  await dbs.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
