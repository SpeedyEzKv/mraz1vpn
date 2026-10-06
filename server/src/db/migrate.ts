// Миграции. Запускается отдельным одноразовым контейнером с правами администратора БД.
// Сервер приложения этих прав не имеет.
//
// Нужны переменные: ADMIN_DATABASE_URL, APP_DB_PASSWORD, SYSTEM_DB_PASSWORD.

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Не задана переменная окружения ${name}`);
  return v;
}

async function ensureRole(client: pg.Client, name: string, password: string, bypassRls: boolean) {
  const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [name]);
  const attrs = `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE ${bypassRls ? 'BYPASSRLS' : 'NOBYPASSRLS'}`;
  const pw = client.escapeLiteral(password);
  if (exists.rowCount === 0) {
    await client.query(`CREATE ROLE ${name} ${attrs} PASSWORD ${pw}`);
  } else {
    await client.query(`ALTER ROLE ${name} ${attrs} PASSWORD ${pw}`);
  }
}

export async function migrate(adminUrl: string, appPassword: string, systemPassword: string) {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await ensureRole(client, 'mraz_app', appPassword, false);
    await ensureRole(client, 'mraz_system', systemPassword, true);

    // Служебная таблица миграций — в отдельной схеме, ролям приложения не видна.
    await client.query('CREATE SCHEMA IF NOT EXISTS meta');
    await client.query(`CREATE TABLE IF NOT EXISTS meta.migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    await client.query('REVOKE ALL ON SCHEMA meta FROM PUBLIC');
    // По умолчанию любой может создавать объекты в public — закрываем.
    await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');

    const dir = join(here, 'migrations');
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    const done = new Set(
      (await client.query<{ name: string }>('SELECT name FROM meta.migrations')).rows.map((r) => r.name),
    );

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO meta.migrations(name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`migration applied: ${file}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file} failed: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate(env('ADMIN_DATABASE_URL'), env('APP_DB_PASSWORD'), env('SYSTEM_DB_PASSWORD'))
    .then(() => console.log('migrations: ok'))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
