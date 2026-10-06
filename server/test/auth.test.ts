import assert from 'node:assert/strict';
import { test } from 'node:test';
import { signInitDataForTest, verifyInitData } from '../src/auth/initData.js';
import { issueSession, readSession } from '../src/auth/session.js';

const TOKEN = '123456:TEST-bot-token';
const now = 1_760_000_000;
const user = JSON.stringify({ id: 111, first_name: 'Аня', username: 'anya' });

const valid = () =>
  signInitDataForTest({ auth_date: String(now - 10), query_id: 'AAA', user, signature: 'sig' }, TOKEN);

test('initData: валидная подпись принимается', () => {
  const r = verifyInitData(valid(), TOKEN, 3600, now);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.user.id, 111);
});

test('initData: подпись другим токеном бота отклоняется', () => {
  const forged = signInitDataForTest({ auth_date: String(now), user }, '999:other');
  assert.deepEqual(verifyInitData(forged, TOKEN, 3600, now), { ok: false, reason: 'bad_signature' });
});

test('initData: подмена user при старом hash отклоняется', () => {
  const p = new URLSearchParams(valid());
  p.set('user', JSON.stringify({ id: 222, first_name: 'Борис' }));
  assert.deepEqual(verifyInitData(p.toString(), TOKEN, 3600, now), { ok: false, reason: 'bad_signature' });
});

test('initData: дублирующийся ключ отклоняется', () => {
  const tampered = valid() + '&user=' + encodeURIComponent(JSON.stringify({ id: 222 }));
  assert.equal(verifyInitData(tampered, TOKEN, 3600, now).ok, false);
});

test('initData: просроченные данные отклоняются', () => {
  const old = signInitDataForTest({ auth_date: String(now - 7200), user }, TOKEN);
  assert.deepEqual(verifyInitData(old, TOKEN, 3600, now), { ok: false, reason: 'expired' });
});

test('initData: дата из будущего отклоняется', () => {
  const future = signInitDataForTest({ auth_date: String(now + 3600), user }, TOKEN);
  assert.deepEqual(verifyInitData(future, TOKEN, 3600, now), { ok: false, reason: 'expired' });
});

test('initData: пустое и мусор отклоняются', () => {
  for (const raw of [undefined, '', 'hash=zz', 'a=1', 123, 'x'.repeat(5000)]) {
    assert.equal(verifyInitData(raw, TOKEN, 3600, now).ok, false);
  }
});

const SECRET = 's'.repeat(40);

test('сессия: выдаётся и читается', () => {
  const { token } = issueSession(111, SECRET, 3600, now);
  assert.equal(readSession(token, SECRET, now + 10), 111);
});

test('сессия: истёкшая не принимается', () => {
  const { token } = issueSession(111, SECRET, 3600, now);
  assert.equal(readSession(token, SECRET, now + 3601), null);
});

test('сессия: подмена uid в payload ломает подпись', () => {
  const { token } = issueSession(111, SECRET, 3600, now);
  const sig = token.split('.')[1];
  const forgedBody = Buffer.from(JSON.stringify({ uid: 222, exp: now + 3600 })).toString('base64url');
  assert.equal(readSession(`${forgedBody}.${sig}`, SECRET, now), null);
});

test('сессия: подпись чужим секретом не принимается', () => {
  const { token } = issueSession(222, 'x'.repeat(40), 3600, now);
  assert.equal(readSession(token, SECRET, now), null);
});
