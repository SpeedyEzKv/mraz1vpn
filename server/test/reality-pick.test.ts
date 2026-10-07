// Подбор сайта для Reality: проверяем критерии на локальных TLS-серверах.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import http2 from 'node:http2';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { pick, probe } from '../src/tools/reality-pick.js';

let key: Buffer;
let cert: Buffer;
const servers: { close(): void }[] = [];
let h2tls13 = 0;
let tls12 = 0;
let h1only = 0;

const listen = (srv: { listen(p: number, h: string, cb: () => void): void; address(): unknown }) =>
  new Promise<number>((r) => srv.listen(0, '127.0.0.1', () => r((srv.address() as AddressInfo).port)));

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rp-'));
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
    '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=test.local',
  ], { stdio: 'ignore' });
  key = readFileSync(join(dir, 'k.pem'));
  cert = readFileSync(join(dir, 'c.pem'));

  const a = http2.createSecureServer({ key, cert, allowHTTP1: true, minVersion: 'TLSv1.3' }, (_q, s) => s.end());
  const b = http2.createSecureServer({ key, cert, allowHTTP1: true, maxVersion: 'TLSv1.2' }, (_q, s) => s.end());
  const c = https.createServer({ key, cert, minVersion: 'TLSv1.3' }, (_q, s) => s.end());
  servers.push(a, b, c);
  h2tls13 = await listen(a);
  tls12 = await listen(b);
  h1only = await listen(c);
});

after(() => servers.forEach((s) => s.close()));

const local = (port: number) => (h: string) => probe(h, { connectHost: '127.0.0.1', port, rejectUnauthorized: false });

test('TLS 1.3 + HTTP/2 + X25519 — подходит', async () => {
  const r = await local(h2tls13)('good.test');
  assert.equal(r.ok, true, r.reason);
});

test('только TLS 1.2 — не подходит', async () => {
  const r = await local(tls12)('old.test');
  assert.equal(r.ok, false);
  assert.match(r.reason!, /TLS 1\.3/);
});

test('без HTTP/2 — не подходит', async () => {
  const r = await local(h1only)('h1.test');
  assert.equal(r.ok, false);
  assert.match(r.reason!, /HTTP\/2/);
});

test('недействительный сертификат — не подходит', async () => {
  const r = await probe('selfsigned.test', { connectHost: '127.0.0.1', port: h2tls13 });
  assert.equal(r.ok, false);
});

test('выбирается самый быстрый из подходящих', async () => {
  const fake = async (h: string) => ({ host: h, ok: h !== 'bad', ms: h === 'fast' ? 10 : h === 'bad' ? 1 : 50 });
  const { best, results } = await pick(['slow', 'bad', 'fast'], fake);
  assert.equal(best, 'fast');
  assert.equal(results.find((r) => r.host === 'bad')!.ok, false);
});
