// Тарифы. Цена в копейках, срок в днях. Меняются только здесь.

export interface Plan {
  id: 'm1' | 'm3' | 'm6' | 'y1';
  title: string; // «3 месяца»
  days: number;
  months: number;
  priceKop: number;
}

export const PLANS: readonly Plan[] = [
  { id: 'm1', title: '1 месяц', days: 30, months: 1, priceKop: 100_00 },
  { id: 'm3', title: '3 месяца', days: 90, months: 3, priceKop: 249_00 },
  { id: 'm6', title: '6 месяцев', days: 180, months: 6, priceKop: 499_00 },
  { id: 'y1', title: '1 год', days: 365, months: 12, priceKop: 999_00 },
];

export const findPlan = (id: unknown): Plan | undefined => PLANS.find((p) => p.id === id);

/** «249.00» — так суммы ждут ЮKassa и CryptoBot. */
export const kopToRub = (kop: number) => (kop / 100).toFixed(2);

/** Название услуги — оно же попадает в чек самозанятого в «Мой налог». */
export const paymentDescription = (p: Plan) => `Доступ к VPN-сервису Mraz1VPN на ${p.title}`;
