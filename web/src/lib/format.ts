// Даты и числа по-русски.

const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

/** «9 октября, 14:30» — в часовом поясе телефона. */
export function formatDateTime(iso: string): string {
  return dateFmt.format(new Date(iso));
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
