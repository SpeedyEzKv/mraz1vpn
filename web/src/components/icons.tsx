// Линейные иконки 24×24, цвет = currentColor, толщина из токена --icon-stroke.
import type { JSX } from 'preact';

type P = { class?: string };

const base = (cls: string | undefined, children: JSX.Element) => (
  <svg
    class={cls ?? 'icon'}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    style={{ strokeWidth: 'var(--icon-stroke)' }}
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const IconShield = ({ class: c }: P) =>
  base(c, <><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" /><path d="M9 12l2 2 4-4" /></>);

export const IconShieldOff = ({ class: c }: P) =>
  base(c, <><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" /><path d="M9.5 9.5l5 5" /><path d="M14.5 9.5l-5 5" /></>);

export const IconHome = ({ class: c }: P) =>
  base(c, <><path d="M4 10.5L12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1v-8.5z" /></>);

export const IconCard = ({ class: c }: P) =>
  base(c, <><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="M3 10h18" /><path d="M7 15h4" /></>);

export const IconDevices = ({ class: c }: P) =>
  base(c, <><rect x="3" y="5" width="13" height="10" rx="1.5" /><path d="M2 18h15" /><rect x="17" y="9" width="5" height="10" rx="1" /></>);

export const IconGift = ({ class: c }: P) =>
  base(
    c,
    <>
      <rect x="3.5" y="8.5" width="17" height="4" rx="1" />
      <path d="M5 12.5V20h14v-7.5" />
      <path d="M12 8.5V20" />
      <path d="M12 8.5c-1.5-3.5-5.5-4-5.5-1.5 0 1.5 2.5 1.5 5.5 1.5z" />
      <path d="M12 8.5c1.5-3.5 5.5-4 5.5-1.5 0 1.5-2.5 1.5-5.5 1.5z" />
    </>,
  );

export const IconHelp = ({ class: c }: P) =>
  base(c, <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 0 1 4.8 1c0 1.7-2.3 2-2.3 3.5" /><path d="M12 17h.01" /></>);

export const IconChat = ({ class: c }: P) =>
  base(c, <><path d="M5 18.5l-1.5 3 4-1.5A9 8 0 1 0 5 18.5z" /><path d="M8.5 11.5h.01" /><path d="M12 11.5h.01" /><path d="M15.5 11.5h.01" /></>);

export const IconBolt = ({ class: c }: P) => base(c, <path d="M13 3L5 13.5h6L10 21l8-10.5h-6L13 3z" />);

export const IconClock = ({ class: c }: P) => base(c, <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);

export const IconInfinity = ({ class: c }: P) =>
  base(c, <path d="M7 15.5c-2 0-3.5-1.6-3.5-3.5S5 8.5 7 8.5c3.5 0 6.5 7 10 7 2 0 3.5-1.6 3.5-3.5S19 8.5 17 8.5c-3.5 0-6.5 7-10 7z" />);

export const IconCopy = ({ class: c }: P) =>
  base(c, <><rect x="8.5" y="8.5" width="12" height="12" rx="2.5" /><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5" /></>);

export const IconShare = ({ class: c }: P) =>
  base(c, <><path d="M12 15V3.5" /><path d="M7.5 8L12 3.5 16.5 8" /><path d="M5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6.5" /></>);

export const IconRefresh = ({ class: c }: P) =>
  base(c, <><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8" /><path d="M4 3.5V8h4.5" /><path d="M4 13a8 8 0 0 0 14.5 4.5L20 16" /><path d="M20 20.5V16h-4.5" /></>);

export const IconUsers = ({ class: c }: P) =>
  base(c, <><circle cx="9" cy="8.5" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6" /><path d="M18 14.2a6.5 6.5 0 0 1 3.5 5.8" /></>);

export const IconCheck = ({ class: c }: P) => base(c, <path d="M5 12.5l4.5 4.5L19 7.5" />);

export const IconChevron = ({ class: c }: P) => base(c ?? 'list__chevron', <path d="M9 6l6 6-6 6" />);

export const IconClose = ({ class: c }: P) => base(c, <><path d="M6 6l12 12" /><path d="M18 6L6 18" /></>);

/** Знак Mraz1VPN: «M» из двух лент, как на аватарке бота. Цвета — из токенов. */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg class="logo" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="logo-a" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--color-brand-1)' }} />
          <stop offset="1" style={{ stopColor: 'var(--color-brand-2)' }} />
        </linearGradient>
        <linearGradient id="logo-b" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--color-brand-2)' }} />
          <stop offset="1" style={{ stopColor: 'var(--color-brand-3)' }} />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" style={{ fill: 'var(--color-surface-2)' }} />
      <path d="M38.5 20L46 46" fill="none" stroke="url(#logo-b)" stroke-width="8.5" stroke-linecap="round" />
      <path d="M38.5 20L32 37" fill="none" stroke="url(#logo-b)" stroke-width="8.5" stroke-linecap="round" />
      <path d="M18 46L25.5 20L32 37" fill="none" stroke="url(#logo-a)" stroke-width="8.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}
