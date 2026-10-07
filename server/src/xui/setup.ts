// Inbound'ы Xray создаёт сам сервер при первом запуске — руками в панели ничего настраивать не нужно.
//
// Схема на одном VPS. Порт 443 у распределителя edge (nginx, по имени сайта): наш домен → Caddy,
// остальное → Xray на 127.0.0.1:XRAY_PORT с PROXY protocol. Ниже — устройство самого Xray
// (в первой версии Reality маскировался под наш домен; теперь — под иностранный сайт, см. REALITY_SERVER_NAME):
//   mraz-vision  VLESS + TCP + Reality + Vision, 0.0.0.0:443.
//                Reality маскируется под наш же домен: всё, что не прошло проверку Reality
//                (браузер, Telegram, сканер), уходит в Caddy (REALITY_TARGET) — сайт и mini app
//                работают как обычно, с настоящим сертификатом.
//                Fallback: соединения Reality, внутри которых не VLESS-TCP, а HTTP/2 (XHTTP),
//                уходят во второй inbound с PROXY protocol, чтобы панель видела IP клиента.
//   mraz-xhttp   VLESS + XHTTP, 127.0.0.1:XHTTP_PORT, без TLS — снаружи недоступен,
//                клиент приходит к нему только через Reality на 443.

import { randomBytes } from 'node:crypto';
import type { XuiApi, XuiInbound } from './client.js';

export const VISION_TAG = 'mraz-vision';
export const XHTTP_TAG = 'mraz-xhttp';

export interface VpnTopology {
  visionInboundId: number;
  xhttpInboundId: number;
  publicKey: string;
  shortId: string;
  serverName: string;
  fingerprint: string;
  xhttpPath: string;
}

export interface TopologyConfig {
  serverName: string; // SNI, под который маскируемся, — крупный иностранный сайт
  realityTarget: string; // куда Xray отдаёт соединения, не прошедшие Reality, — тот же сайт, host:443
  xrayPort: number; // порт inbound'а Reality внутри (за распределителем — 4443)
  xhttpPort: number; // внутренний порт XHTTP-inbound'а
  // На сервере перед Xray стоит распределитель по SNI (nginx), он передаёт IP клиента по PROXY protocol.
  acceptProxyProtocol: boolean;
}

const SNIFFING = JSON.stringify({ enabled: true, destOverride: ['http', 'tls', 'quic'], metadataOnly: false, routeOnly: true });

function parse<T>(raw: unknown, what: string): T {
  if (raw && typeof raw === 'object') return raw as T;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    throw new Error(`3x-ui: не разобрать ${what}`);
  }
}

interface RealityStream {
  security: string;
  sockopt?: { acceptProxyProtocol?: boolean };
  realitySettings?: {
    target?: string;
    dest?: string;
    serverNames?: string[];
    shortIds?: string[];
    settings?: { publicKey?: string; fingerprint?: string };
  };
}
interface XhttpStream {
  network: string;
  xhttpSettings?: { path?: string };
}

/** Достаёт параметры для ссылок клиентов из уже созданных inbound'ов. */
export function readTopology(vision: XuiInbound, xhttp: XuiInbound): VpnTopology {
  const vs = parse<RealityStream>(vision.streamSettings, 'streamSettings mraz-vision');
  const xs = parse<XhttpStream>(xhttp.streamSettings, 'streamSettings mraz-xhttp');
  const r = vs.realitySettings;
  const publicKey = r?.settings?.publicKey;
  const shortId = r?.shortIds?.find((s) => s.length > 0);
  const serverName = r?.serverNames?.[0];
  const xhttpPath = xs.xhttpSettings?.path;
  if (vs.security !== 'reality' || !publicKey || !shortId || !serverName) {
    throw new Error('3x-ui: у mraz-vision нет Reality-ключа, shortId или serverName');
  }
  if (xs.network !== 'xhttp' || !xhttpPath) throw new Error('3x-ui: у mraz-xhttp нет пути XHTTP');
  return {
    visionInboundId: vision.id,
    xhttpInboundId: xhttp.id,
    publicKey,
    shortId,
    serverName,
    fingerprint: r?.settings?.fingerprint || 'chrome',
    xhttpPath,
  };
}

/** Создаёт недостающие inbound'ы и fallback. Повторный вызов ничего не меняет. */
export async function ensureTopology(xui: XuiApi, cfg: TopologyConfig): Promise<VpnTopology> {
  const byTag = async () => new Map((await xui.listInbounds()).map((i) => [i.tag, i]));
  let inbounds = await byTag();

  if (!inbounds.has(XHTTP_TAG)) {
    await xui.addInbound({
      remark: 'Mraz1VPN XHTTP (через Reality)',
      enable: true,
      listen: '127.0.0.1',
      port: cfg.xhttpPort,
      protocol: 'vless',
      tag: XHTTP_TAG,
      settings: JSON.stringify({ clients: [], decryption: 'none', encryption: 'none' }),
      streamSettings: JSON.stringify({
        network: 'xhttp',
        security: 'none',
        xhttpSettings: { path: `/${randomBytes(8).toString('hex')}`, host: '', mode: 'auto' },
        sockopt: { acceptProxyProtocol: true },
      }),
      sniffing: SNIFFING,
    });
  }

  if (!inbounds.has(VISION_TAG)) {
    const keys = await xui.newX25519();
    await xui.addInbound({
      remark: 'Mraz1VPN Reality Vision',
      enable: true,
      listen: cfg.acceptProxyProtocol ? '127.0.0.1' : '',
      port: cfg.xrayPort,
      protocol: 'vless',
      tag: VISION_TAG,
      settings: JSON.stringify({ clients: [], decryption: 'none', encryption: 'none', fallbacks: [] }),
      streamSettings: JSON.stringify({
        network: 'tcp',
        tcpSettings: { header: { type: 'none' } },
        security: 'reality',
        sockopt: { acceptProxyProtocol: cfg.acceptProxyProtocol },
        realitySettings: {
          show: false,
          xver: 0,
          target: cfg.realityTarget,
          serverNames: [cfg.serverName],
          privateKey: keys.privateKey,
          minClientVer: '',
          maxClientVer: '',
          maxTimediff: 0,
          shortIds: [randomBytes(8).toString('hex')],
          settings: { publicKey: keys.publicKey, fingerprint: 'chrome', serverName: '', spiderX: '/' },
        },
      }),
      sniffing: SNIFFING,
    });
  }

  inbounds = await byTag();
  let vision = inbounds.get(VISION_TAG);
  const xhttp = inbounds.get(XHTTP_TAG);
  if (!vision || !xhttp) throw new Error('3x-ui: inbound не создался');

  // Маскировку (куда отдавать «чужие» соединения и под какое имя) можно поменять в .env —
  // приводим уже созданный inbound к настройкам. Ключи и shortId не трогаем: ссылки у клиентов
  // обновятся сами при следующем обновлении подписки (в них поменяется только sni).
  const vs = parse<RealityStream & Record<string, unknown>>(vision.streamSettings, 'streamSettings mraz-vision');
  const r = vs.realitySettings ?? {};
  const wantProxy = cfg.acceptProxyProtocol;
  const wantListen = cfg.acceptProxyProtocol ? '127.0.0.1' : '';
  const outdated =
    vision.port !== cfg.xrayPort ||
    (vision.listen ?? '') !== wantListen ||
    (r.target ?? r.dest) !== cfg.realityTarget ||
    JSON.stringify(r.serverNames ?? []) !== JSON.stringify([cfg.serverName]) ||
    Boolean(vs.sockopt?.acceptProxyProtocol) !== wantProxy;
  if (outdated) {
    const stream = {
      ...vs,
      sockopt: { ...(vs.sockopt ?? {}), acceptProxyProtocol: wantProxy },
      realitySettings: { ...r, target: cfg.realityTarget, serverNames: [cfg.serverName] },
    };
    delete (stream.realitySettings as Record<string, unknown>).dest;
    const asString = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v ?? {}));
    await xui.updateInbound(vision.id, {
      remark: vision.remark,
      enable: vision.enable,
      listen: wantListen,
      port: cfg.xrayPort,
      protocol: vision.protocol,
      tag: vision.tag,
      settings: asString(vision.settings),
      streamSettings: JSON.stringify(stream),
      sniffing: asString(vision.sniffing),
    });
    vision = (await byTag()).get(VISION_TAG)!;
  }

  // xver 2 — PROXY protocol v2: XHTTP-inbound узнаёт настоящий IP клиента (нужен для лимита устройств).
  await xui.setFallbacks(vision.id, [{ childId: xhttp.id, xver: 2 }]);

  return readTopology(vision, xhttp);
}
