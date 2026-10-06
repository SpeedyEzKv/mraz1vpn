// Проверка initData из Telegram Mini App.
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
//
// secret_key = HMAC_SHA256(key = "WebAppData", data = bot_token)
// hash       = hex(HMAC_SHA256(key = secret_key, data = data_check_string))
// data_check_string — все поля, кроме hash, отсортированные по ключу, "key=value" через "\n".

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export type InitDataResult =
  | { ok: true; user: TelegramUser; authDate: number }
  | { ok: false; reason: 'empty' | 'malformed' | 'bad_signature' | 'expired' | 'no_user' };

const MAX_INITDATA_LENGTH = 4096;

export function verifyInitData(
  raw: unknown,
  botToken: string,
  maxAgeSec: number,
  nowSec = Math.floor(Date.now() / 1000),
): InitDataResult {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, reason: 'empty' };
  if (raw.length > MAX_INITDATA_LENGTH) return { ok: false, reason: 'malformed' };

  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return { ok: false, reason: 'malformed' };

  // Повторяющиеся ключи — признак подделки.
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) return { ok: false, reason: 'malformed' };

  const dataCheckString = keys
    .filter((k) => k !== 'hash')
    .sort()
    .map((k) => `${k}=${params.get(k)}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secretKey).update(dataCheckString).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }

  // Подпись верна. Дальше — свежесть и содержимое.
  const authDate = Number(params.get('auth_date'));
  if (!Number.isSafeInteger(authDate) || authDate <= 0) return { ok: false, reason: 'malformed' };
  if (nowSec - authDate > maxAgeSec || authDate - nowSec > 60) return { ok: false, reason: 'expired' };

  const userRaw = params.get('user');
  if (!userRaw) return { ok: false, reason: 'no_user' };
  let user: TelegramUser;
  try {
    user = JSON.parse(userRaw);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) return { ok: false, reason: 'no_user' };

  return { ok: true, user, authDate };
}

/** Только для тестов: подписать initData так же, как это делает Telegram. */
export function signInitDataForTest(fields: Record<string, string>, botToken: string): string {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}
