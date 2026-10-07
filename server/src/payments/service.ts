// Оплата: создать платёж у провайдера, принять подтверждение, продлить подписку ровно один раз.
//
// Доверяем только самому провайдеру:
//  - ЮKassa: на вебхук не полагаемся — по id из него перезапрашиваем платёж через API своим ключом;
//  - CryptoBot: вебхук с проверенной подписью (HMAC по токену), плюс перезапрос при сверке.
// Если вебхук потерялся, раз в минуту сверка опрашивает провайдера по всем ожидающим платежам.

import { sql } from 'kysely';
import type { Databases } from '../db/db.js';
import type { Logger } from '../vpn/service.js';
import { grantDays } from '../vpn/grant.js';
import type { CryptoBotApi, CryptoInvoice } from './cryptobot.js';
import { findPlan, kopToRub, paymentDescription, PLANS } from './plans.js';
import type { YooKassaApi, YooPayment } from './yookassa.js';

export type Provider = 'yookassa' | 'cryptobot';

export class PaymentError extends Error {
  constructor(readonly code: 'bad_plan' | 'provider_unavailable' | 'too_many' | 'provider_failed') {
    super(code);
  }
}

export interface Notifier {
  send(userId: number, text: string): Promise<void>;
}

export function createPaymentService(deps: {
  dbs: Databases;
  yookassa: YooKassaApi | null;
  cryptobot: CryptoBotApi | null;
  domain: string;
  botUsername: string;
  deviceLimit: number;
  referralBonusDays?: number;
  onSubscriptionChanged: (userId: number) => Promise<void>;
  notifier: Notifier;
  log: Logger;
}) {
  const { dbs, log } = deps;

  const providers = (): Provider[] =>
    [deps.yookassa ? ('yookassa' as const) : null, deps.cryptobot ? ('cryptobot' as const) : null].filter(
      (p): p is Provider => p !== null,
    );

  function catalog() {
    const base = PLANS[0]!;
    return {
      providers: providers(),
      plans: PLANS.map((p) => ({
        id: p.id,
        title: p.title,
        days: p.days,
        priceRub: p.priceKop / 100,
        perMonthRub: Math.round(p.priceKop / p.months / 100),
        // Выгода относительно помесячной оплаты, в процентах.
        discountPct: Math.max(0, Math.round((1 - p.priceKop / (base.priceKop * p.months)) * 100)),
      })),
    };
  }

  /** Создаёт платёж и возвращает ссылку на оплату. userId — из сессии. */
  async function create(userId: number, planId: unknown, provider: unknown) {
    const plan = findPlan(planId);
    if (!plan) throw new PaymentError('bad_plan');
    if (provider !== 'yookassa' && provider !== 'cryptobot') throw new PaymentError('provider_unavailable');
    if (!providers().includes(provider)) throw new PaymentError('provider_unavailable');

    // От случайных серий нажатий и перебора: не больше 10 незавершённых платежей за час.
    const recent = await dbs.system
      .selectFrom('payments')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('user_id', '=', userId)
      .where('status', '=', 'pending')
      .where('created_at', '>', sql<Date>`now() - interval '1 hour'`)
      .executeTakeFirstOrThrow();
    if (Number(recent.n) >= 10) throw new PaymentError('too_many');

    const row = await dbs.system
      .insertInto('payments')
      .values({
        user_id: userId,
        provider,
        plan: plan.id,
        days: plan.days,
        amount_kop: plan.priceKop,
        provider_payment_id: null,
        pay_url: null,
        paid_at: null,
        applied_at: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    let providerId: string;
    let url: string;
    try {
      if (provider === 'yookassa') {
        const p = await deps.yookassa!.createPayment({
          amountRub: kopToRub(plan.priceKop),
          description: paymentDescription(plan),
          returnUrl: `https://${deps.domain}/paid`,
          idempotenceKey: `mraz1vpn-payment-${row.id}`,
          metadata: { payment_id: String(row.id), user_id: String(userId) },
        });
        if (!p.confirmation?.confirmation_url) throw new Error('ЮKassa не вернула ссылку на оплату');
        providerId = p.id;
        url = p.confirmation.confirmation_url;
      } else {
        const inv = await deps.cryptobot!.createInvoice({
          amountRub: kopToRub(plan.priceKop),
          description: paymentDescription(plan),
          payload: String(row.id),
          expiresInSec: 3600,
          paidBtnUrl: `https://t.me/${deps.botUsername}`,
        });
        providerId = String(inv.invoice_id);
        url = inv.bot_invoice_url;
      }
    } catch (e) {
      log.error({ err: (e as Error).message, paymentId: row.id }, 'payments: провайдер не создал платёж');
      await dbs.system.updateTable('payments').set({ status: 'failed' }).where('id', '=', row.id).execute();
      throw new PaymentError('provider_failed');
    }

    await dbs.system
      .updateTable('payments')
      .set({ provider_payment_id: providerId, pay_url: url })
      .where('id', '=', row.id)
      .execute();
    return { id: row.id, provider, url };
  }

  /** Статус для кабинета — под ролью юзера, чужой платёж RLS не покажет. */
  async function getStatus(userId: number, paymentId: number) {
    if (!Number.isSafeInteger(paymentId) || paymentId <= 0) return undefined;
    return dbs.asUser(userId, (tx) =>
      tx.selectFrom('payments').select(['id', 'status', 'plan']).where('id', '=', paymentId).executeTakeFirst(),
    );
  }

  /**
   * Превращает оплату в дни подписки. Ровно один раз: строка платежа блокируется, applied_at ставится
   * в той же транзакции. Срок считается от конца текущей подписки (если она ещё идёт) или от сейчас.
   */
  async function apply(paymentId: number, paidAt: Date): Promise<boolean> {
    const result = await dbs.system.transaction().execute(async (tx) => {
      const pay = await tx
        .selectFrom('payments')
        .select(['id', 'user_id', 'days', 'applied_at', 'status'])
        .where('id', '=', paymentId)
        .forUpdate()
        .executeTakeFirst();
      if (!pay || pay.applied_at) return null;

      const granted = await grantDays(tx, pay.user_id, pay.days, { deviceLimit: deps.deviceLimit, markActive: true });
      await tx
        .updateTable('payments')
        .set({ status: 'succeeded', paid_at: paidAt, applied_at: sql<Date>`now()` })
        .where('id', '=', pay.id)
        .execute();

      // Бонус пригласившему — за первую оплату приглашённого, один раз (уникальность referred_id).
      let referral: { referrerId: number; expiresAt: Date } | null = null;
      const bonus = deps.referralBonusDays ?? 0;
      if (bonus > 0) {
        const u = await tx.selectFrom('users').select('referred_by').where('id', '=', pay.user_id).executeTakeFirst();
        if (u?.referred_by) {
          const rewarded = await tx
            .insertInto('referral_rewards')
            .values({ referrer_id: u.referred_by, referred_id: pay.user_id, payment_id: pay.id, days: bonus })
            .onConflict((oc) => oc.column('referred_id').doNothing())
            .returning('id')
            .executeTakeFirst();
          if (rewarded) {
            const g = await grantDays(tx, u.referred_by, bonus, { deviceLimit: deps.deviceLimit, markActive: false });
            referral = { referrerId: u.referred_by, expiresAt: g.expiresAt };
          }
        }
      }

      return { userId: pay.user_id, expiresAt: granted.expiresAt, referral };
    });

    if (!result) return false;
    log.info({ paymentId, userId: result.userId }, 'payments: подписка продлена');
    try {
      await deps.onSubscriptionChanged(result.userId);
    } catch (e) {
      log.warn({ err: (e as Error).message }, 'payments: панель обновит сверка');
    }
    await deps.notifier
      .send(result.userId, `Оплата прошла. Подписка действует до ${formatMsk(result.expiresAt)} (МСК).`)
      .catch((e) => log.warn({ err: (e as Error).message }, 'payments: сообщение не отправлено'));
    if (result.referral) {
      const { referrerId, expiresAt } = result.referral;
      log.info({ referrerId, referredId: result.userId }, 'referrals: бонус начислен');
      await deps.onSubscriptionChanged(referrerId).catch(() => undefined);
      await deps.notifier
        .send(referrerId, `🎉 Ваш друг оформил подписку — вам +${deps.referralBonusDays} дней. VPN работает до ${formatMsk(expiresAt)} (МСК).`)
        .catch(() => undefined);
    }
    return true;
  }

  async function markClosed(paymentId: number, status: 'canceled' | 'expired') {
    await dbs.system
      .updateTable('payments')
      .set({ status })
      .where('id', '=', paymentId)
      .where('status', '=', 'pending')
      .execute();
  }

  async function findByProviderId(provider: Provider, providerId: string) {
    return dbs.system
      .selectFrom('payments')
      .select(['id', 'amount_kop', 'status'])
      .where('provider', '=', provider)
      .where('provider_payment_id', '=', providerId)
      .executeTakeFirst();
  }

  /** Платёж ЮKassa по данным самой ЮKassa (не из вебхука). */
  async function handleYooPayment(p: YooPayment) {
    const row = await findByProviderId('yookassa', p.id);
    if (!row) return;
    if (p.status === 'succeeded' && p.paid) {
      const amountOk = p.amount.currency === 'RUB' && Math.round(Number(p.amount.value) * 100) === row.amount_kop;
      if (!amountOk || p.metadata?.payment_id !== String(row.id)) {
        log.error({ paymentId: row.id, yoo: p.id }, 'payments: сумма или метаданные ЮKassa не совпали — не продлеваю');
        return;
      }
      await apply(row.id, p.captured_at ? new Date(p.captured_at) : new Date());
    } else if (p.status === 'canceled') {
      await markClosed(row.id, 'canceled');
    }
  }

  async function handleCryptoInvoice(inv: CryptoInvoice) {
    const row = await findByProviderId('cryptobot', String(inv.invoice_id));
    if (!row) return;
    if (inv.status === 'paid') {
      const amountOk = inv.currency_type === 'fiat' && inv.fiat === 'RUB' && Math.round(Number(inv.amount) * 100) === row.amount_kop;
      if (!amountOk || inv.payload !== String(row.id)) {
        log.error({ paymentId: row.id, invoice: inv.invoice_id }, 'payments: сумма или payload CryptoBot не совпали — не продлеваю');
        return;
      }
      await apply(row.id, inv.paid_at ? new Date(inv.paid_at) : new Date());
    } else if (inv.status === 'expired') {
      await markClosed(row.id, 'expired');
    }
  }

  /** Вебхук ЮKassa: берём из него только id и перезапрашиваем платёж. */
  async function onYooKassaWebhook(body: unknown) {
    const id = (body as { object?: { id?: unknown } } | null)?.object?.id;
    if (!deps.yookassa || typeof id !== 'string' || !/^[\w-]{10,64}$/.test(id)) return;
    await handleYooPayment(await deps.yookassa.getPayment(id));
  }

  /** Вебхук CryptoBot: подпись уже проверена. */
  async function onCryptoBotWebhook(update: unknown) {
    const u = update as { update_type?: string; payload?: CryptoInvoice } | null;
    if (u?.update_type !== 'invoice_paid' || !u.payload) return;
    await handleCryptoInvoice(u.payload);
  }

  /** Сверка: опрашиваем провайдеров по ожидающим платежам (на случай потерянного вебхука). */
  async function pollPending(): Promise<{ checked: number }> {
    const pending = await dbs.system
      .selectFrom('payments')
      .select(['id', 'provider', 'provider_payment_id', 'created_at'])
      .where('status', '=', 'pending')
      .where('provider_payment_id', 'is not', null)
      .where('created_at', '>', sql<Date>`now() - interval '1 day'`)
      .execute();

    const crypto = pending.filter((p) => p.provider === 'cryptobot');
    if (crypto.length && deps.cryptobot) {
      try {
        const invoices = await deps.cryptobot.getInvoices(crypto.map((p) => Number(p.provider_payment_id)));
        for (const inv of invoices) await handleCryptoInvoice(inv);
      } catch (e) {
        log.warn({ err: (e as Error).message }, 'payments: CryptoBot недоступен');
      }
    }
    for (const p of pending.filter((x) => x.provider === 'yookassa')) {
      if (!deps.yookassa) break;
      try {
        await handleYooPayment(await deps.yookassa.getPayment(p.provider_payment_id!));
      } catch (e) {
        log.warn({ err: (e as Error).message, paymentId: p.id }, 'payments: ЮKassa недоступна');
      }
    }
    // Брошенные больше суток назад — закрываем, чтобы не опрашивать вечно.
    await dbs.system
      .updateTable('payments')
      .set({ status: 'expired' })
      .where('status', '=', 'pending')
      .where('created_at', '<=', sql<Date>`now() - interval '1 day'`)
      .execute();
    return { checked: pending.length };
  }

  return { catalog, create, getStatus, apply, onYooKassaWebhook, onCryptoBotWebhook, pollPending };
}

export type PaymentService = ReturnType<typeof createPaymentService>;

const mskFmt = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
export const formatMsk = (d: Date) => mskFmt.format(d);
