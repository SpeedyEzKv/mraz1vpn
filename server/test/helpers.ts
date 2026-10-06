// Общее для тестов с Postgres: отдельная база на файл тестов, миграции, роли приложения.
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createDatabases } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import type { XuiApi, XuiClientInput, XuiClientState, XuiInbound } from '../src/xui/client.js';

export const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5433/postgres';
// Роли общие на весь кластер, поэтому пароли одинаковые во всех тестовых файлах.
export const APP_PASS = 'app-pass';
export const SYSTEM_PASS = 'system-pass';

export const withDb = (url: string, db: string, user?: string, password?: string) => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  if (user) u.username = user;
  if (password) u.password = password;
  return u.toString();
};

export async function createTestDb() {
  const name = `mraz_test_${randomBytes(4).toString('hex')}`;
  const root = new pg.Client({ connectionString: ADMIN_URL });
  await root.connect();
  await root.query(`CREATE DATABASE ${name}`);
  await root.end();

  const adminUrl = withDb(ADMIN_URL, name);
  await migrate(adminUrl, APP_PASS, SYSTEM_PASS);
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const appUrl = withDb(ADMIN_URL, name, 'mraz_app', APP_PASS);
  const systemUrl = withDb(ADMIN_URL, name, 'mraz_system', SYSTEM_PASS);
  const dbs = createDatabases(appUrl, systemUrl);

  async function drop() {
    await dbs.close();
    await admin.end();
    const r = new pg.Client({ connectionString: ADMIN_URL });
    await r.connect();
    await r.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await r.end();
  }
  return { name, admin, dbs, appUrl, systemUrl, drop };
}

/** Панель 3x-ui в памяти: хранит клиентов, считает вызовы, умеет «падать». */
export function fakeXui() {
  const clients = new Map<string, XuiClientState>();
  const inbounds: XuiInbound[] = [];
  const calls: string[] = [];
  let down = false;

  const guard = (name: string) => {
    calls.push(name);
    if (down) throw new Error('3x-ui недоступна: fake down');
  };
  const toState = (c: XuiClientInput, inboundIds: number[]): XuiClientState => ({
    client: { email: c.email, uuid: c.id, enable: c.enable, expiryTime: c.expiryTime, limitIp: c.limitIp, flow: c.flow },
    inboundIds,
  });

  const api: XuiApi = {
    async listInbounds() {
      guard('listInbounds');
      return inbounds;
    },
    async addInbound(i) {
      guard('addInbound');
      const row = { ...i, id: inbounds.length + 1 } as XuiInbound;
      inbounds.push(row);
      return row;
    },
    async setFallbacks() {
      guard('setFallbacks');
    },
    async newX25519() {
      guard('newX25519');
      return { privateKey: 'priv', publicKey: 'PUBKEY' };
    },
    async getClient(email) {
      guard('getClient');
      return clients.get(email) ?? null;
    },
    async addClient(c, inboundIds) {
      guard('addClient');
      if (clients.has(c.email)) throw new Error('duplicate email');
      clients.set(c.email, toState(c, inboundIds));
    },
    async updateClient(email, c) {
      guard('updateClient');
      const cur = clients.get(email);
      if (!cur) throw new Error('record not found');
      clients.set(email, toState(c, cur.inboundIds));
    },
    async attachClient(email, ids) {
      guard('attachClient');
      const cur = clients.get(email);
      if (!cur) throw new Error('record not found');
      cur.inboundIds = [...new Set([...cur.inboundIds, ...ids])];
    },
  };
  return {
    api,
    clients,
    calls,
    setDown(v: boolean) {
      down = v;
    },
  };
}
