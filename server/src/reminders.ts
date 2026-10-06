// Напоминания в боте: за 3 дня и за 1 день до конца подписки и в момент окончания.
// Сначала запись в reminders (уникальна на подписку + вид + срок), потом сообщение:
// при любом сбое напоминание не придёт дважды. Продлили подписку — срок новый, напомним снова.

import { sql } from 'kysely';
import type { Databases } from './db/db.js';
import type { Notifier } from './payments/service.js';
import { formatMsk } from './payments/service.js';
import type { Logger } from './vpn/service.js';

type Kind = '3d' | '1d' | 'expired';

function text(kind: Kind, trial: boolean, expiresAt: Date): string {
  const what = trial ? 'Пробный период' : 'Подписка';
  if (kind === '3d') return `${what} Mraz1VPN закончится через 3 дня — ${formatMsk(expiresAt)} (МСК). Продлить можно в кабинете.`;
  if (kind === '1d') return `${what} Mraz1VPN закончится завтра — ${formatMsk(expiresAt)} (МСК). Продлите в кабинете, чтобы VPN не отключился.`;
  return `${what} Mraz1VPN закончилась, VPN отключён. Продлите в кабинете — ссылка на устройствах останется прежней.`;
}

export async function sendReminders(dbs: Databases, notifier: Notifier, log: Logger): Promise<{ sent: number }> {
  // Кандидаты: подписки, у которых срок попадает в окно напоминания.
  const rows = await dbs.system
    .selectFrom('subscriptions')
    .select([
      'id',
      'user_id',
      'status',
      'expires_at',
      sql<Kind | null>`case
        when expires_at <= now() and expires_at > now() - interval '2 days' then 'expired'
        when expires_at > now() and expires_at <= now() + interval '1 day' then '1d'
        when status <> 'trial' and expires_at > now() + interval '1 day' and expires_at <= now() + interval '3 days' then '3d'
      end`.as('kind'),
    ])
    .where('status', '<>', 'archived')
    .where('expires_at', 'is not', null)
    .where('expires_at', '>', sql<Date>`now() - interval '2 days'`)
    .where('expires_at', '<=', sql<Date>`now() + interval '3 days'`)
    .execute();

  let sent = 0;
  for (const r of rows) {
    if (!r.kind || !r.expires_at) continue;
    const claimed = await dbs.system
      .insertInto('reminders')
      .values({ user_id: r.user_id, subscription_id: r.id, kind: r.kind, expires_at: r.expires_at })
      .onConflict((oc) => oc.columns(['subscription_id', 'kind', 'expires_at']).doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!claimed) continue;
    try {
      await notifier.send(r.user_id, text(r.kind, r.status === 'trial', r.expires_at));
      sent++;
    } catch (e) {
      // Юзер заблокировал бота и т. п. Повторять не будем — запись уже сделана.
      log.warn({ err: (e as Error).message, userId: r.user_id }, 'reminders: не отправлено');
    }
  }
  return { sent };
}
