// Подбор сайта для маскировки Reality. Запускается на самом сервере (scripts/reality-pick.sh):
// из списка крупных иностранных сайтов берёт тот, что отвечает быстрее всех и подходит Reality —
// TLS 1.3, HTTP/2 и обмен ключами X25519, с действительным сертификатом.
// Печатает выбранный домен в stdout, таблицу замеров — в stderr.

import tls from 'node:tls';

export const CANDIDATES = [
  'www.samsung.com',
  'www.nvidia.com',
  'www.amd.com',
  'www.intel.com',
  'www.asus.com',
  'www.dell.com',
  'www.lenovo.com',
  'www.logitech.com',
  'www.cisco.com',
  'www.oracle.com',
  'www.yahoo.com',
  'dl.google.com',
];

export interface Probe {
  host: string;
  ok: boolean;
  ms: number;
  reason?: string;
}

export function probe(
  host: string,
  opts: { connectHost?: string; port?: number; rejectUnauthorized?: boolean; timeoutMs?: number } = {},
): Promise<Probe> {
  return new Promise((resolve) => {
    const started = performance.now();
    const socket = tls.connect({
      host: opts.connectHost ?? host,
      port: opts.port ?? 443,
      servername: host,
      ALPNProtocols: ['h2', 'http/1.1'],
      minVersion: 'TLSv1.2',
      rejectUnauthorized: opts.rejectUnauthorized ?? true,
    });
    const done = (r: Omit<Probe, 'host' | 'ms'>) => {
      socket.destroy();
      resolve({ host, ms: Math.round(performance.now() - started), ...r });
    };
    socket.setTimeout(opts.timeoutMs ?? 5000, () => done({ ok: false, reason: 'таймаут' }));
    socket.once('error', (e) => done({ ok: false, reason: e.message }));
    socket.once('secureConnect', () => {
      const key = socket.getEphemeralKeyInfo() as { name?: string } | null;
      if (socket.getProtocol() !== 'TLSv1.3') return done({ ok: false, reason: `нет TLS 1.3 (${socket.getProtocol()})` });
      if (socket.alpnProtocol !== 'h2') return done({ ok: false, reason: 'нет HTTP/2' });
      if (key?.name && key.name !== 'X25519') return done({ ok: false, reason: `обмен ключами ${key.name}, нужен X25519` });
      done({ ok: true });
    });
  });
}

/** Три замера на кандидата, берём медиану; лучший — подходящий с наименьшей задержкой. */
export async function pick(candidates: string[], probeFn: (h: string) => Promise<Probe> = (h) => probe(h)) {
  const results: Probe[] = [];
  for (const host of candidates) {
    const runs: Probe[] = [];
    for (let i = 0; i < 3; i++) runs.push(await probeFn(host));
    const bad = runs.find((r) => !r.ok);
    const ms = runs.map((r) => r.ms).sort((a, b) => a - b)[1]!;
    results.push(bad ? { host, ok: false, ms, reason: bad.reason } : { host, ok: true, ms });
  }
  const best = results.filter((r) => r.ok).sort((a, b) => a.ms - b.ms)[0];
  return { best: best?.host ?? null, results };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const list = process.argv.slice(2).length ? process.argv.slice(2) : CANDIDATES;
  const { best, results } = await pick(list);
  for (const r of results) {
    process.stderr.write(`${r.ok ? 'подходит  ' : 'нет       '} ${String(r.ms).padStart(5)} мс  ${r.host}${r.reason ? `  (${r.reason})` : ''}\n`);
  }
  if (!best) {
    process.stderr.write('Ни один сайт не подошёл — проверьте, что у сервера есть доступ в интернет.\n');
    process.exit(1);
  }
  process.stdout.write(best + '\n');
}
