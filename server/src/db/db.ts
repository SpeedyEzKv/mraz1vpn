import { Kysely, PostgresDialect, sql, type Generated, type Transaction } from 'kysely';
import pg from 'pg';

// int8 → number. telegram_id помещается в безопасный диапазон JS.
pg.types.setTypeParser(20, (v) => Number(v));

export interface UsersTable {
  id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  language_code: string | null;
  is_premium: Generated<boolean>;
  created_at: Generated<Date>;
  last_seen_at: Generated<Date>;
}

export interface SubscriptionsTable {
  id: Generated<number>;
  user_id: number;
  status: 'trial' | 'active' | 'expired' | 'archived';
  expires_at: Date | null;
  created_at: Generated<Date>;
  archived_at: Date | null;
}

export interface VpnKeysTable {
  id: Generated<number>;
  user_id: number;
  subscription_id: number;
  sub_token: string;
  created_at: Generated<Date>;
  revoked_at: Date | null;
}

export interface Database {
  users: UsersTable;
  subscriptions: SubscriptionsTable;
  vpn_keys: VpnKeysTable;
}

export type Db = Kysely<Database>;
export type Tx = Transaction<Database>;

function makeDb(url: string): Db {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 5 }) }),
  });
}

/**
 * Два подключения с разными ролями.
 * - asUser: роль mraz_app, RLS действует. Все запросы от имени юзера идут только так.
 * - system: роль mraz_system, RLS обходится. Только для бота, вебхуков, фоновых задач, админки.
 */
export function createDatabases(appUrl: string, systemUrl: string) {
  const appDb = makeDb(appUrl);
  const systemDb = makeDb(systemUrl);

  async function asUser<T>(userId: number, fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('asUser: неверный userId');
    return appDb.transaction().execute(async (tx) => {
      // set_config(..., true) — значение живёт только до конца транзакции,
      // в пуле соединений ничего не «протекает» к следующему запросу.
      await sql`SELECT set_config('app.user_id', ${String(userId)}, true)`.execute(tx);
      return fn(tx);
    });
  }

  async function close() {
    await Promise.all([appDb.destroy(), systemDb.destroy()]);
  }

  return { asUser, system: systemDb, close };
}

export type Databases = ReturnType<typeof createDatabases>;
