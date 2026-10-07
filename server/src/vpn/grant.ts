// Добавить дни к подписке юзера внутри уже открытой транзакции (оплата, бонус за друга).
// Срок считается от конца текущей подписки, если она ещё идёт, иначе — от сейчас.
// Если подписки или действующего ключа нет — создаёт их.

import { sql } from 'kysely';
import type { Tx } from '../db/db.js';
import { newSubToken } from './service.js';

export async function grantDays(
  tx: Tx,
  userId: number,
  days: number,
  opts: { deviceLimit: number; markActive: boolean },
): Promise<{ subscriptionId: number; expiresAt: Date }> {
  const sub = await tx
    .selectFrom('subscriptions')
    .select(['id', 'status', 'expires_at'])
    .where('user_id', '=', userId)
    .where('status', '<>', 'archived')
    .forUpdate()
    .executeTakeFirst();

  let subscriptionId: number;
  if (sub) {
    // Оплата делает подписку платной (active). Бонус пробник не «повышает», но истёкшую — оживляет.
    const expired = !sub.expires_at || sub.expires_at <= new Date();
    const status = opts.markActive || expired ? 'active' : sub.status;
    await tx
      .updateTable('subscriptions')
      .set({
        status,
        expires_at: sql<Date>`greatest(coalesce(expires_at, now()), now()) + make_interval(days => ${days})`,
        updated_at: sql<Date>`now()`,
      })
      .where('id', '=', sub.id)
      .execute();
    subscriptionId = sub.id;
  } else {
    const created = await tx
      .insertInto('subscriptions')
      .values({
        user_id: userId,
        status: 'active',
        expires_at: sql<Date>`now() + make_interval(days => ${days})`,
        device_limit: opts.deviceLimit,
        archived_at: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    subscriptionId = created.id;
  }

  const key = await tx
    .selectFrom('vpn_keys')
    .select('id')
    .where('subscription_id', '=', subscriptionId)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  if (!key) {
    await tx
      .insertInto('vpn_keys')
      .values({ user_id: userId, subscription_id: subscriptionId, sub_token: newSubToken(), revoked_at: null, panel_synced_at: null })
      .execute();
  }

  const s = await tx.selectFrom('subscriptions').select('expires_at').where('id', '=', subscriptionId).executeTakeFirstOrThrow();
  return { subscriptionId, expiresAt: s.expires_at! };
}
