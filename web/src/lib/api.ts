// Клиент API. Сессия живёт только в памяти вкладки.
// Истекла — молча входим заново по свежему initData, юзер ничего не замечает.

import { getInitData } from './telegram';

export class AuthError extends Error {}

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
  if (!res.ok) throw new Error(`${path} ${res.status}`);
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

export async function getBotUsername(): Promise<string | null> {
  try {
    const res = await fetch('/api/public-config');
    if (!res.ok) return null;
    return (await res.json()).botUsername ?? null;
  } catch {
    return null;
  }
}
