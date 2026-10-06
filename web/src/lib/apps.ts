// VPN-приложения, которые мы советуем, и как в них добавить подписку одной кнопкой.
import type { Platform } from './telegram';

export type AppId = 'happ' | 'v2raytun' | 'hiddify' | 'streisand';

export interface StoreLink {
  label: string;
  url: string;
}

export interface VpnApp {
  id: AppId;
  name: string;
  stores: Partial<Record<Platform, StoreLink[]>>;
  /** Ссылка, по которой приложение само добавит подписку. */
  deepLink: (subscriptionUrl: string) => string;
}

const HIDDIFY_RELEASES = 'https://github.com/hiddify/hiddify-app/releases/latest';

export const APPS: VpnApp[] = [
  {
    id: 'happ',
    name: 'Happ',
    stores: {
      ios: [
        { label: 'App Store (Россия)', url: 'https://apps.apple.com/ru/app/happ-proxy-utility-plus/id6746188973' },
        { label: 'App Store (другие страны)', url: 'https://apps.apple.com/us/app/happ-proxy-utility/id6504287215' },
      ],
      android: [{ label: 'Google Play', url: 'https://play.google.com/store/apps/details?id=com.happproxy' }],
    },
    deepLink: (u) => `happ://add/${u}`,
  },
  {
    id: 'v2raytun',
    name: 'v2RayTun',
    stores: {
      ios: [{ label: 'App Store', url: 'https://apps.apple.com/app/v2raytun/id6476628951' }],
      android: [{ label: 'Google Play', url: 'https://play.google.com/store/apps/details?id=com.v2raytun.android' }],
    },
    deepLink: (u) => `v2raytun://import/${u}`,
  },
  {
    id: 'hiddify',
    name: 'Hiddify',
    stores: {
      ios: [{ label: 'App Store', url: 'https://apps.apple.com/app/hiddify-proxy-vpn/id6596777532' }],
      android: [{ label: 'Скачать с GitHub', url: HIDDIFY_RELEASES }],
      desktop: [{ label: 'Windows, macOS, Linux', url: HIDDIFY_RELEASES }],
    },
    deepLink: (u) => `hiddify://import/${u}#Mraz1VPN`,
  },
  {
    id: 'streisand',
    name: 'Streisand',
    stores: {
      ios: [{ label: 'App Store', url: 'https://apps.apple.com/ru/app/streisand/id6450534064' }],
    },
    deepLink: (u) => `streisand://import/${u}#Mraz1VPN`,
  },
];

/** Первым в списке — рекомендуемое для платформы. */
const RECOMMENDED: Record<Platform, AppId> = { ios: 'happ', android: 'happ', desktop: 'hiddify' };

export function appsFor(platform: Platform): { app: VpnApp; recommended: boolean }[] {
  return APPS.filter((a) => a.stores[platform]?.length)
    .map((app) => ({ app, recommended: app.id === RECOMMENDED[platform] }))
    .sort((a, b) => Number(b.recommended) - Number(a.recommended));
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  ios: 'iPhone и iPad',
  android: 'Android',
  desktop: 'Компьютер',
};

/**
 * Telegram открывает только http(s)-ссылки, поэтому схему приложения (happ://…) открываем
 * через нашу страницу /open в браузере телефона. Она пропускает только наши ссылки подписки.
 */
export function openPageUrl(deepLink: string): string {
  return `${window.location.origin}/open#${encodeURIComponent(deepLink)}`;
}

const SCHEMES = ['happ://add/', 'v2raytun://import/', 'hiddify://import/', 'streisand://import/'];

/** Проверка для страницы /open: схема из списка, ссылка подписки — на наш домен. */
export function isAllowedDeepLink(link: string, origin: string): boolean {
  const scheme = SCHEMES.find((s) => link.startsWith(s));
  if (!scheme) return false;
  const rest = link.slice(scheme.length).replace(/#Mraz1VPN$/, '');
  return rest.startsWith(`${origin}/sub/`) && /^[A-Za-z0-9_-]{32}$/.test(rest.slice(origin.length + 5));
}
