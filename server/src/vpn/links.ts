// Ссылки VLESS и тело подписки. Подписку отдаёт наш сервер (/sub/<token>), а не 3x-ui:
// срок и статус берутся из нашей базы, токен можно отозвать, панель наружу не светится.

import type { VpnTopology } from '../xui/setup.js';

export interface Endpoint {
  host: string; // IP сервера (или домен)
  port: number; // 443
}

const enc = encodeURIComponent;

function query(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${k}=${enc(v)}`)
    .join('&');
}

/** Две ссылки на один ключ: основная (TCP + Vision) и запасная (XHTTP) — на случай, если первую режут. */
export function buildVlessLinks(t: VpnTopology, ep: Endpoint, uuid: string): string[] {
  const reality = {
    encryption: 'none',
    security: 'reality',
    pbk: t.publicKey,
    fp: t.fingerprint,
    sni: t.serverName,
    sid: t.shortId,
    spx: '/',
  };
  const base = `vless://${uuid}@${ep.host}:${ep.port}`;
  return [
    `${base}?${query({ type: 'tcp', ...reality, flow: 'xtls-rprx-vision' })}#${enc('Mraz1VPN')}`,
    `${base}?${query({ type: 'xhttp', ...reality, path: t.xhttpPath, mode: 'auto' })}#${enc('Mraz1VPN запасной')}`,
  ];
}

/** Вместо ключей — одна «ссылка-табличка»: клиент покажет её название, подключиться по ней нельзя. */
export function placeholderLink(title: string): string {
  return `vless://00000000-0000-0000-0000-000000000000@0.0.0.0:1?encryption=none&type=tcp#${enc(title)}`;
}

export interface SubscriptionBody {
  body: string;
  headers: Record<string, string>;
}

export function subscriptionResponse(opts: {
  links: string[];
  expiresAt: Date | null;
  title: string;
  supportUrl: string;
}): SubscriptionBody {
  const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
  const expire = opts.expiresAt ? Math.floor(opts.expiresAt.getTime() / 1000) : 0;
  return {
    body: b64(opts.links.join('\n')),
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      // Название и срок в приложениях (Happ, v2RayTun, Hiddify, Streisand понимают эти заголовки).
      'profile-title': `base64:${b64(opts.title)}`,
      'profile-update-interval': '12',
      'subscription-userinfo': `upload=0; download=0; total=0; expire=${expire}`,
      'support-url': opts.supportUrl,
      'profile-web-page-url': opts.supportUrl,
      'content-disposition': `attachment; filename="${opts.title.replace(/[^\w.-]/g, '')}"`,
    },
  };
}
