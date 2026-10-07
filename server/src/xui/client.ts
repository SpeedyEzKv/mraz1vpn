// Клиент API панели 3x-ui (v3.9+). Авторизация — API-токен (Bearer), выданный командой
//   x-ui setting -getApiToken -tokenName mraz1vpn
// Панель доступна серверу только по внутренней сети Docker; наружу её порт не открыт.

export interface XuiInbound {
  id: number;
  remark: string;
  enable: boolean;
  listen: string;
  port: number;
  protocol: string;
  tag: string;
  // Новые версии панели отдают объекты, старые — JSON-строки. Отправляем строками.
  settings: string | Record<string, unknown>;
  streamSettings: string | Record<string, unknown>;
  sniffing?: string | Record<string, unknown>;
}

/** Клиент в панели. Один на юзера, подключён к обоим нашим inbound'ам. */
export interface XuiClientInput {
  id: string; // UUID VLESS
  email: string;
  flow: string;
  limitIp: number;
  totalGB: number;
  expiryTime: number; // мс; 0 — бессрочно
  enable: boolean;
  tgId: number;
  subId: string;
  comment: string;
  reset: number;
}

export interface XuiClientState {
  client: { email: string; uuid: string; enable: boolean; expiryTime: number; limitIp: number; flow: string };
  inboundIds: number[];
}

export class XuiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

interface Envelope<T> {
  success: boolean;
  msg: string;
  obj: T;
}

export interface XuiApi {
  listInbounds(): Promise<XuiInbound[]>;
  addInbound(inbound: Omit<XuiInbound, 'id'>): Promise<XuiInbound>;
  updateInbound(id: number, inbound: Omit<XuiInbound, 'id'>): Promise<void>;
  setFallbacks(masterId: number, fallbacks: { childId: number; xver: number }[]): Promise<void>;
  newX25519(): Promise<{ privateKey: string; publicKey: string }>;
  getClient(email: string): Promise<XuiClientState | null>;
  addClient(client: XuiClientInput, inboundIds: number[]): Promise<void>;
  updateClient(email: string, client: XuiClientInput): Promise<void>;
  attachClient(email: string, inboundIds: number[]): Promise<void>;
}

export function createXuiClient(baseUrl: string, apiToken: string, timeoutMs = 10_000): XuiApi {
  const root = baseUrl.replace(/\/+$/, '') + '/panel/api';

  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(root + path, {
        method,
        headers: {
          authorization: `Bearer ${apiToken}`,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new XuiError(`3x-ui недоступна: ${(e as Error).message}`);
    }
    if (!res.ok) throw new XuiError(`3x-ui ${method} ${path}: HTTP ${res.status}`, res.status);
    const env = (await res.json()) as Envelope<T>;
    if (!env.success) throw new XuiError(`3x-ui ${method} ${path}: ${env.msg || 'ошибка'}`);
    return env.obj;
  }

  return {
    listInbounds: () => call<XuiInbound[]>('GET', '/inbounds/list'),

    addInbound: (inbound) => call<XuiInbound>('POST', '/inbounds/add', inbound),

    async updateInbound(id, inbound) {
      await call('POST', `/inbounds/update/${id}`, inbound);
    },

    async setFallbacks(masterId, fallbacks) {
      await call('POST', `/inbounds/${masterId}/fallbacks`, { fallbacks });
    },

    newX25519: () => call('GET', '/server/getNewX25519Cert'),

    async getClient(email) {
      try {
        return await call<XuiClientState>('GET', `/clients/get/${encodeURIComponent(email)}`);
      } catch (e) {
        // Панель отвечает success=false, если клиента нет.
        if (e instanceof XuiError && e.status === undefined && /record not found/i.test(e.message)) return null;
        throw e;
      }
    },

    async addClient(client, inboundIds) {
      await call('POST', '/clients/add', { client, inboundIds });
    },

    async updateClient(email, client) {
      await call('POST', `/clients/update/${encodeURIComponent(email)}`, client);
    },

    async attachClient(email, inboundIds) {
      await call('POST', `/clients/${encodeURIComponent(email)}/attach`, { inboundIds });
    },
  };
}
