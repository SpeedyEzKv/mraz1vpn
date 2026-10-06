// Crypto Pay API (@CryptoBot). Счёт выставляем в рублях — CryptoBot сам пересчитает
// в USDT, TON и другие монеты по курсу. Тестовая сеть: testnet-pay.crypt.bot (@CryptoTestnetBot).

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export interface CryptoInvoice {
  invoice_id: number;
  status: 'active' | 'paid' | 'expired';
  currency_type: 'crypto' | 'fiat';
  fiat?: string;
  amount: string;
  bot_invoice_url: string;
  mini_app_invoice_url?: string;
  payload?: string;
  paid_at?: string;
}

export interface CryptoBotApi {
  createInvoice(input: {
    amountRub: string;
    description: string;
    payload: string;
    expiresInSec: number;
    paidBtnUrl: string;
  }): Promise<CryptoInvoice>;
  getInvoices(ids: number[]): Promise<CryptoInvoice[]>;
}

export function createCryptoBot(token: string, testnet = false, baseUrl?: string): CryptoBotApi {
  const root = baseUrl ?? `https://${testnet ? 'testnet-pay.crypt.bot' : 'pay.crypt.bot'}/api`;

  async function call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${root}/${method}`, {
      method: 'POST',
      headers: { 'crypto-pay-api-token': token, 'content-type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => null)) as { ok: boolean; result: T; error?: { name?: string } } | null;
    if (!json?.ok) throw new Error(`CryptoBot ${method}: ${json?.error?.name ?? `HTTP ${res.status}`}`);
    return json.result;
  }

  return {
    createInvoice: (i) =>
      call<CryptoInvoice>('createInvoice', {
        currency_type: 'fiat',
        fiat: 'RUB',
        amount: i.amountRub,
        description: i.description.slice(0, 1024),
        payload: i.payload,
        expires_in: i.expiresInSec,
        paid_btn_name: 'openBot',
        paid_btn_url: i.paidBtnUrl,
        allow_comments: false,
        allow_anonymous: true,
      }),
    async getInvoices(ids) {
      const r = await call<{ items: CryptoInvoice[] }>('getInvoices', { invoice_ids: ids.join(',') });
      return r.items;
    },
  };
}

/**
 * Подпись вебхука: заголовок crypto-pay-api-signature = HMAC-SHA256(тело запроса, ключ = SHA256(токен)), hex.
 * Проверяем по сырому телу — так, как его прислал CryptoBot.
 */
export function verifyCryptoBotSignature(token: string, rawBody: string, signature: unknown): boolean {
  if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const secret = createHash('sha256').update(token).digest();
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
