// Все секреты читаются только здесь и только из окружения сервера.
// В клиент (mini app) ничего из этого файла не уходит.

function required(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Не задана переменная окружения ${name}`);
  return v.trim();
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

function parseIds(raw: string): Set<number> {
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const n = Number(s);
        if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`ADMIN_IDS: неверный id "${s}"`);
        return n;
      }),
  );
}

function int(name: string, fallback: number, min: number, max: number): number {
  const n = Number(optional(name, String(fallback)));
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name}: ожидается целое от ${min} до ${max}`);
  return n;
}

export function loadConfig() {
  const domain = required('DOMAIN');
  const sessionSecret = required('SESSION_SECRET');
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET должен быть не короче 32 символов');

  return {
    port: Number(optional('PORT', '3000')),
    domain,
    botToken: required('BOT_TOKEN'),
    botUsername: required('BOT_USERNAME').replace(/^@/, ''),
    // polling — для локальной разработки, webhook — на сервере
    botMode: optional('BOT_MODE', 'webhook') as 'webhook' | 'polling',
    botWebhookSecret: required('BOT_WEBHOOK_SECRET'),
    webAppUrl: optional('WEBAPP_URL', `https://${domain}/`),
    adminIds: parseIds(optional('ADMIN_IDS', '')),
    sessionSecret,
    sessionTtlSec: Number(optional('SESSION_TTL_SEC', '3600')),
    initDataMaxAgeSec: Number(optional('INITDATA_MAX_AGE_SEC', '86400')),
    appDatabaseUrl: required('APP_DATABASE_URL'),
    systemDatabaseUrl: required('SYSTEM_DATABASE_URL'),

    // 3x-ui: адрес панели во внутренней сети (с секретным путём) и API-токен.
    xuiUrl: required('XUI_URL'),
    xuiApiToken: required('XUI_API_TOKEN'),
    // Куда подключаются клиенты VPN и под какой домен маскируется Reality.
    vpnHost: optional('VPN_HOST', domain),
    vpnPort: int('VPN_PORT', 443, 1, 65535),
    // Под какой сайт маскируется Reality и куда Xray отдаёт соединения, не прошедшие проверку.
    // Подбирает scripts/reality-pick.sh: крупный иностранный сайт с TLS 1.3 и HTTP/2.
    realityServerName: required('REALITY_SERVER_NAME'),
    realityTarget: optional('REALITY_TARGET', `${required('REALITY_SERVER_NAME')}:443`),
    // Порт inbound'а Xray внутри и приём PROXY protocol от распределителя edge.
    xrayPort: int('XRAY_PORT', 4443, 1, 65535),
    realityAcceptProxyProtocol: optional('REALITY_ACCEPT_PROXY_PROTOCOL', 'true') === 'true',
    xhttpPort: int('XHTTP_PORT', 10443, 1, 65535),
    trialDays: int('TRIAL_DAYS', 3, 1, 30),

    // Оплата. Провайдер без ключей просто не показывается в кабинете.
    yookassaShopId: optional('YOOKASSA_SHOP_ID', ''),
    yookassaSecretKey: optional('YOOKASSA_SECRET_KEY', ''),
    cryptobotToken: optional('CRYPTOBOT_TOKEN', ''),
    cryptobotTestnet: optional('CRYPTOBOT_TESTNET', 'false') === 'true',
    // Только для локальной разработки: адреса имитаций API провайдеров.
    yookassaApiUrl: optional('YOOKASSA_API_URL', 'https://api.yookassa.ru/v3'),
    cryptobotApiUrl: process.env.CRYPTOBOT_API_URL?.trim() || undefined,
    deviceLimit: int('DEVICE_LIMIT', 3, 1, 10),
  };
}

export type Config = ReturnType<typeof loadConfig>;
