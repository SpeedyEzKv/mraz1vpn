// Даты и числа по-русски.

const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const dateYearFmt = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** «9 октября в 14:30», для другого года — «7 января 2027 г. в 18:49». В часовом поясе телефона. */
export function formatDateTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  return (d.getFullYear() === now.getFullYear() ? dateFmt : dateYearFmt).format(d);
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** «2 дня», «5 часов», «меньше часа». */
export function formatTimeLeft(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return 'закончилась';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'меньше часа';
  if (hours < 24) return `${hours} ${plural(hours, 'час', 'часа', 'часов')}`;
  // Вверх: сразу после старта трёхдневного периода — «3 дня», а не «2 дня» из-за прошедших минут.
  const days = Math.ceil(ms / 86_400_000);
  return `${days} ${plural(days, 'день', 'дня', 'дней')}`;
}

/** Сколько полных суток осталось, с округлением вверх (как в formatTimeLeft); 0 — закончилась. */
export function daysLeft(iso: string, now = Date.now()): number {
  const ms = new Date(iso).getTime() - now;
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}

const dayFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

/** «12 октября». */
export const formatDay = (iso: string) => dayFmt.format(new Date(iso));

/** «100 ₽», «66,42 ₽». */
export const formatRub = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2).replace('.', ',')} ₽`;
