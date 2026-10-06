// Клиент API. Сессия живёт только в памяти вкладки.
// Истекла — молча входим заново по свежему initData, юзер ничего не замечает.

import { getInitData } from './telegram';

export class AuthError extends Error {}

/** Ответ сервера с кодом ошибки (например, 409 trial_used). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(code ?? `HTTP ${status}`);
  }
}

let session: { token: string; expiresAt: number } | null = null;
let loginInFlight: Promise<void> | null = null;

async function login(): Promise<void> {
  const res = await fetch('/api/auth/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initData: getInitData() }),
  });
  if (res.status === 401) throw new AuthError('auth');
  if (!res.ok) throw new Error(`login ${res.status}`);
  session = await res.json();
}

function ensureLogin(): Promise<void> {
  const fresh = session && session.expiresAt - 30 > Date.now() / 1000;
  if (fresh) return Promise.resolve();
  loginInFlight ??= login().finally(() => {
    loginInFlight = null;
  });
  return loginInFlight;
}

export async function api<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  await ensureLogin();
  const res = await fetch(path, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${session!.token}` },
  });
  if (res.status === 401 && !retried) {
    session = null;
    return api<T>(path, init, true);
  }
  if (res.status === 401) throw new AuthError('auth');
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? null);
  }
  return res.json() as Promise<T>;
}

export interface Me {
  id: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  isAdmin: boolean;
}

export const getMe = () => api<Me>('/api/me');

export type VpnStatus = 'none' | 'trial' | 'active' | 'expired';

export interface Vpn {
  status: VpnStatus;
  expiresAt: string | null;
  trialAvailable: boolean;
  trialDays: number;
  deviceLimit: number;
  subscriptionUrl: string | null;
}

export const getVpn = () => api<Vpn>('/api/vpn');
// POST без тела: сервер ничего не ждёт, userId берётся из сессии.
export const startTrial = () => api<Vpn>('/api/vpn/trial', { method: 'POST' });
export const rotateKey = () => api<Vpn>('/api/vpn/rotate', { method: 'POST' });

export async function getBotUsername(): Promise<string | null> {
  try {
    const res = await fetch('/api/public-config');
    if (!res.ok) return null;
    return (await res.json()).botUsername ?? null;
  } catch {
    return null;
  }
}
