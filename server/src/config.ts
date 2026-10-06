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

export function loadConfig() {
  const sessionSecret = required('SESSION_SECRET');
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET должен быть не короче 32 символов');

  return {
    port: Number(optional('PORT', '3000')),
    domain: required('DOMAIN'),
    botToken: required('BOT_TOKEN'),
    botUsername: required('BOT_USERNAME').replace(/^@/, ''),
    // polling — для локальной разработки, webhook — на сервере
    botMode: optional('BOT_MODE', 'webhook') as 'webhook' | 'polling',
    botWebhookSecret: required('BOT_WEBHOOK_SECRET'),
    webAppUrl: optional('WEBAPP_URL', `https://${required('DOMAIN')}/`),
    adminIds: parseIds(optional('ADMIN_IDS', '')),
    sessionSecret,
    sessionTtlSec: Number(optional('SESSION_TTL_SEC', '3600')),
    initDataMaxAgeSec: Number(optional('INITDATA_MAX_AGE_SEC', '86400')),
    appDatabaseUrl: required('APP_DATABASE_URL'),
    systemDatabaseUrl: required('SYSTEM_DATABASE_URL'),
  };
}

export type Config = ReturnType<typeof loadConfig>;
