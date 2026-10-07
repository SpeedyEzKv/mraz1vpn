// Юнит-тесты помощников mini app. Запуск: npm test (Node 22, без сборки).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { APPS, appsFor, isAllowedDeepLink } from '../src/lib/apps.ts';
import { formatDateTime, formatTimeLeft, plural } from '../src/lib/format.ts';

const ORIGIN = 'https://mraz1vpn.ru';
const SUB = `${ORIGIN}/sub/${'a'.repeat(31)}B`;

test('/open пропускает наши ссылки во всех четырёх приложениях', () => {
  for (const app of APPS) assert.equal(isAllowedDeepLink(app.deepLink(SUB), ORIGIN), true, app.id);
});

test('/open не пропускает чужие и подменённые ссылки', () => {
  const bad = [
    'javascript:alert(1)',
    'https://evil.example/',
    `happ://add/https://evil.example/sub/${'a'.repeat(32)}`,
    `happ://add/${ORIGIN}.evil.example/sub/${'a'.repeat(32)}`,
    `happ://add/${ORIGIN}/sub/short`,
    `happ://add/${ORIGIN}/sub/${'a'.repeat(32)}/../../admin`,
    `happ://add/${ORIGIN}/sub/${'a'.repeat(32)}#other`,
    `intent://add/${SUB}`,
    '',
  ];
  for (const link of bad) assert.equal(isAllowedDeepLink(link, ORIGIN), false, link);
});

test('у каждой платформы есть рекомендуемое приложение, и оно первое', () => {
  for (const p of ['ios', 'android', 'desktop'] as const) {
    const list = appsFor(p);
    assert.ok(list.length > 0, p);
    assert.equal(list[0]!.recommended, true, p);
    assert.equal(list.filter((a) => a.recommended).length, 1, p);
  }
});

test('склонение', () => {
  assert.deepEqual(
    [1, 2, 5, 11, 21, 22, 25, 111].map((n) => `${n} ${plural(n, 'день', 'дня', 'дней')}`),
    ['1 день', '2 дня', '5 дней', '11 дней', '21 день', '22 дня', '25 дней', '111 дней'],
  );
});

test('остаток срока', () => {
  const now = Date.parse('2026-10-06T12:00:00Z');
  const at = (ms: number) => new Date(now + ms).toISOString();
  assert.equal(formatTimeLeft(at(3 * 864e5 - 60_000), now), '3 дня');
  assert.equal(formatTimeLeft(at(5 * 3_600_000), now), '5 часов');
  assert.equal(formatTimeLeft(at(30 * 60_000), now), 'меньше часа');
  assert.equal(formatTimeLeft(at(-1), now), 'закончилась');
});

test('дата: год показываем, только если он не текущий', () => {
  const now = new Date('2026-10-06T12:00:00');
  assert.doesNotMatch(formatDateTime('2026-10-09T15:30:00', now), /2026/);
  assert.match(formatDateTime('2027-01-07T18:49:00', now), /2027/);
});

test('daysLeft: вверх до суток, после окончания — 0', async () => {
  const { daysLeft } = await import('../src/lib/format.ts');
  const now = Date.parse('2026-10-08T12:00:00Z');
  assert.equal(daysLeft('2026-10-11T11:59:00Z', now), 3);
  assert.equal(daysLeft('2026-10-08T13:00:00Z', now), 1);
  assert.equal(daysLeft('2026-10-08T11:00:00Z', now), 0);
});
