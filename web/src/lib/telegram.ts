// Тонкая обёртка над официальным мостом Telegram (telegram-web-app.js).

interface BackButton {
  show(): void;
  hide(): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
}

interface TelegramWebApp {
  initData: string;
  platform: string;
  version: string;
  colorScheme: 'light' | 'dark';
  isVersionAtLeast(v: string): boolean;
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  setBottomBarColor?(color: string): void;
  openTelegramLink(url: string): void;
  BackButton: BackButton;
  HapticFeedback?: { selectionChanged(): void };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

const webApp: TelegramWebApp | undefined = window.Telegram?.WebApp;

/**
 * initData — подписанные Telegram данные о юзере. Проверяет их только сервер.
 * Если мост не загрузился, но кабинет открыт из Telegram, данные всё равно лежат в адресе.
 */
export function getInitData(): string {
  if (webApp?.initData) return webApp.initData;
  const hash = new URLSearchParams(window.location.hash.slice(1));
  return hash.get('tgWebAppData') ?? '';
}

export function isInsideTelegram(): boolean {
  return getInitData().length > 0;
}

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Подготовка окна: раскрыть на весь экран, покрасить шапку и низ Telegram в цвет фона из токенов. */
export function setupTelegramChrome() {
  if (!webApp) return;
  const bg = token('--color-bg');
  try {
    webApp.ready();
    webApp.expand();
    if (bg) {
      webApp.setHeaderColor(bg);
      webApp.setBackgroundColor(bg);
      if (webApp.isVersionAtLeast('7.10')) webApp.setBottomBarColor?.(bg);
    }
    // Чтобы прокрутка списка вниз не закрывала кабинет случайно.
    if (webApp.isVersionAtLeast('7.7')) webApp.disableVerticalSwipes?.();
  } catch {
    // Старые клиенты Telegram поддерживают не всё — это не мешает работе.
  }
}

export function haptic() {
  try {
    webApp?.HapticFeedback?.selectionChanged();
  } catch {
    /* нет поддержки — ничего страшного */
  }
}

/** Системная кнопка «Назад» Telegram. Возвращает функцию для отписки. */
export function bindBackButton(cb: () => void): () => void {
  if (!webApp?.BackButton) return () => {};
  const bb = webApp.BackButton;
  bb.onClick(cb);
  bb.show();
  return () => {
    bb.offClick(cb);
    bb.hide();
  };
}

export function openTelegramLink(url: string) {
  if (webApp) webApp.openTelegramLink(url);
  else window.location.href = url;
}
