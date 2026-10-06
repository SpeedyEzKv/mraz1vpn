// Сессия: короткий токен, подписанный HMAC-SHA256 секретом сервера.
// Формат: base64url(payload).base64url(signature). payload = { uid, exp }.
// Клиент хранит токен только в памяти; когда истёк — молча входит заново по initData.

import { createHmac, timingSafeEqual } from 'node:crypto';

interface SessionPayload {
  uid: number;
  exp: number;
}

function sign(data: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(data).digest();
}

export function issueSession(uid: number, secret: string, ttlSec: number, nowSec = Math.floor(Date.now() / 1000)) {
  const payload: SessionPayload = { uid, exp: nowSec + ttlSec };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = sign(body, secret).toString('base64url');
  return { token: `${body}.${sig}`, expiresAt: payload.exp };
}

export function readSession(token: unknown, secret: string, nowSec = Math.floor(Date.now() / 1000)): number | null {
  if (typeof token !== 'string' || token.length > 512) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];

  const expected = sign(body, secret);
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!Number.isSafeInteger(payload.uid) || payload.uid <= 0) return null;
  if (!Number.isSafeInteger(payload.exp) || payload.exp <= nowSec) return null;
  return payload.uid;
}
