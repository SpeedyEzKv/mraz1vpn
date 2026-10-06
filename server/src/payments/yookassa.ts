// ЮKassa, API v3 (https://api.yookassa.ru/v3). Авторизация — shopId:secretKey (Basic).
// Магазин самозанятого: чек в «Мой налог» ЮKassa формирует сама по описанию платежа,
// поэтому receipt не передаём. Способ оплаты (СБП или карта) покупатель выбирает на странице ЮKassa.

export interface YooPayment {
  id: string;
  status: 'pending' | 'waiting_for_capture' | 'succeeded' | 'canceled';
  paid: boolean;
  amount: { value: string; currency: string };
  confirmation?: { type: string; confirmation_url?: string };
  metadata?: Record<string, string>;
  captured_at?: string;
}

export interface YooKassaApi {
  createPayment(input: {
    amountRub: string;
    description: string;
    returnUrl: string;
    idempotenceKey: string;
    metadata: Record<string, string>;
  }): Promise<YooPayment>;
  getPayment(id: string): Promise<YooPayment>;
}

export function createYooKassa(shopId: string, secretKey: string, baseUrl = 'https://api.yookassa.ru/v3'): YooKassaApi {
  const auth = 'Basic ' + Buffer.from(`${shopId}:${secretKey}`).toString('base64');

  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, idempotenceKey?: string): Promise<T> {
    const res = await fetch(baseUrl + path, {
      method,
      headers: {
        authorization: auth,
        'content-type': 'application/json',
        ...(idempotenceKey ? { 'idempotence-key': idempotenceKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => null)) as T & { description?: string };
    if (!res.ok) throw new Error(`ЮKassa ${method} ${path}: HTTP ${res.status} ${json?.description ?? ''}`.trim());
    return json;
  }

  return {
    createPayment: (i) =>
      call<YooPayment>(
        'POST',
        '/payments',
        {
          amount: { value: i.amountRub, currency: 'RUB' },
          capture: true,
          confirmation: { type: 'redirect', return_url: i.returnUrl },
          description: i.description.slice(0, 128),
          metadata: i.metadata,
        },
        i.idempotenceKey,
      ),
    getPayment: (id) => call<YooPayment>('GET', `/payments/${encodeURIComponent(id)}`),
  };
}
