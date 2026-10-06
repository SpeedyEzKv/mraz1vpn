// Базовые компоненты: кнопка, карточка, список, поле ввода, нижний шит, экран.
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useId } from 'preact/hooks';
import { bindBackButton } from '../lib/telegram';
import { IconChevron, IconClose } from './icons';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/* ---------- Кнопка ---------- */
type ButtonProps = {
  variant?: 'primary' | 'secondary' | 'plain';
  size?: 'default' | 'small';
  block?: boolean;
  href?: string;
  children: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'size'> & { disabled?: boolean; type?: 'button' | 'submit' };

export function Button({ variant = 'primary', size = 'default', block, href, children, ...rest }: ButtonProps) {
  const cls = cx('btn', `btn--${variant}`, size === 'small' && 'btn--small', block && 'btn--block');
  if (href) {
    return (
      <a class={cls} href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  return (
    <button type="button" class={cls} {...rest}>
      {children}
    </button>
  );
}

/* ---------- Карточка ---------- */
export function Card({ title, children, actions }: { title?: string; children?: ComponentChildren; actions?: ComponentChildren }) {
  return (
    <section class="card">
      {title && <h2 class="card__title">{title}</h2>}
      {children}
      {actions && <div class="card__actions">{actions}</div>}
    </section>
  );
}

/* ---------- Список ---------- */
export function List({ title, children }: { title?: string; children: ComponentChildren }) {
  return (
    <div>
      {title && <div class="section-title" style={{ marginBottom: 'var(--space-2)' }}>{title}</div>}
      <div class="list">{children}</div>
    </div>
  );
}

type ListItemProps = {
  title: ComponentChildren;
  subtitle?: ComponentChildren;
  value?: ComponentChildren;
  onClick?: () => void;
};

export function ListItem({ title, subtitle, value, onClick }: ListItemProps) {
  const body = (
    <>
      <div class="list__body">
        <div class="list__title">{title}</div>
        {subtitle && <div class="list__subtitle">{subtitle}</div>}
      </div>
      {value !== undefined && <div class="list__value">{value}</div>}
      {onClick && <IconChevron />}
    </>
  );
  return onClick ? (
    <button type="button" class="list__item" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div class="list__item">{body}</div>
  );
}

/* ---------- Поле ввода ---------- */
type FieldProps = {
  label: string;
  hint?: string;
  error?: string;
} & JSX.HTMLAttributes<HTMLInputElement>;

export function Field({ label, hint, error, ...input }: FieldProps) {
  const id = useId();
  const hintText = error ?? hint;
  return (
    <div class={cx('field', error && 'field--invalid')}>
      <label class="field__label" for={id}>
        {label}
      </label>
      <input id={id} class="field__input" aria-invalid={!!error} {...input} />
      {hintText && <div class="field__hint">{hintText}</div>}
    </div>
  );
}

/* ---------- Нижний шит ---------- */
type SheetProps = { open: boolean; title?: string; onClose: () => void; children: ComponentChildren };

export function Sheet({ open, title, onClose, children }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const unBack = bindBackButton(onClose);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      unBack();
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div class="sheet-scrim" onClick={onClose} />
      <div class="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div class="sheet__handle" />
        <div class="sheet__header">
          <div class="sheet__title">{title}</div>
          <Button variant="plain" size="small" onClick={onClose} aria-label="Закрыть">
            <IconClose />
          </Button>
        </div>
        {children}
      </div>
    </>
  );
}

/* ---------- Экран и состояния ---------- */
export function Screen({ title, children }: { title: string; children?: ComponentChildren }) {
  return (
    <div class="screen">
      <h1 class="screen__title">{title}</h1>
      {children}
    </div>
  );
}

export function CenterState({ title, text, actions }: { title: string; text?: ComponentChildren; actions?: ComponentChildren }) {
  return (
    <div class="center-state">
      <h1 class="center-state__title">{title}</h1>
      {text && <p class="text-secondary">{text}</p>}
      {actions && <div class="center-state__actions">{actions}</div>}
    </div>
  );
}
