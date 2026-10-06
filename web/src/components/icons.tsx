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

export const IconDevices = ({ class: c }: P) =>
  base(c, <><rect x="3" y="5" width="13" height="10" rx="1.5" /><path d="M2 18h15" /><rect x="17" y="9" width="5" height="10" rx="1" /></>);

export const IconHelp = ({ class: c }: P) =>
  base(c, <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 0 1 4.8 1c0 1.7-2.3 2-2.3 3.5" /><path d="M12 17h.01" /></>);

export const IconChevron = ({ class: c }: P) => base(c ?? 'list__chevron', <path d="M9 6l6 6-6 6" />);

export const IconClose = ({ class: c }: P) => base(c, <><path d="M6 6l12 12" /><path d="M18 6L6 18" /></>);
