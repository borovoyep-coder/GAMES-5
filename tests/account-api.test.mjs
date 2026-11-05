import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleApi } from '../worker/api.mjs';

const origin = 'https://vetatlas.example';
const date = '2026-11-05T12:00:00.000Z';
const migration = readFileSync(new URL('../drizzle/0000_student_accounts.sql', import.meta.url), 'utf8');
const who = {
  A: { 'oai-authenticated-user-id': 'site-user-A', 'oai-authenticated-user-email': 'a@example.test' },
  B: { 'oai-authenticated-user-id': 'site-user-B', 'oai-authenticated-user-email': 'b@example.test' },
};
function state(overrides = {}) {
  return { version: 1, read: { atopy: date }, favorites: ['demodex'], notes: { atopy: 'Повторить диагностику.' },
    results: [{ id: 'quiz-1', topic: 'atopy', title: 'Атопический дерматит', correct: 4, total: 5, date }],
    activities: [{ id: 'case-1', topic: 'demodex', mode: 'case', correct: 1, total: 1, date }],
    lastArticle: 'atopy', ...overrides };
}
function payload(expectedRevision = 0, overrides = {}) {
  return { profile: { displayName: ' Анна ', group: ' В-261 ' }, state: state(), expectedRevision, ...overrides };
}
function database(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(migration);
  t.after(() => sqlite.close());
  const calls = [];
  const DB = { prepare(sql) { calls.push(sql); return { bind(...values) {
    return { async first() { return sqlite.prepare(sql).get(...values) || null; } };
  } }; } };
  return { sqlite, calls, env: { DB } };
}
function request(path = '/api/account', { method = 'GET', user = 'A', body, headers = {} } = {}) {
  const all = { ...(who[user] || {}), ...(who[user] ? { 'X-VetAtlas-Owner': who[user]['oai-authenticated-user-id'] } : {}), ...headers };
  if (method === 'PUT') {
    Object.assign(all, { Origin: origin, 'Content-Type': 'application/json', 'X-VetAtlas-Request': '1', ...headers });
  }
  for (const key of Object.keys(all)) if (all[key] === null) delete all[key];
  return new Request(origin + path, { method, headers: all, ...(body === undefined ? {} : { body: typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body) }) });
}
async function call(env, options = {}, path = '/api/account') {
  const response = await handleApi(request(path, options), env);
  assert(response instanceof Response);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(response.headers.get('set-cookie'), null);
  return { response, body: await response.json() };
}

test('public pass-through, unknown API404 and method405 never return static HTML', async () => {
  assert.equal(await handleApi(request('/')), null);
  assert.equal(await handleApi(request('/signin-with-chatgpt')), null);
  assert.equal(await handleApi(request('/signout-with-chatgpt')), null);
  assert.equal(await handleApi(request('/callback')), null);
  assert.equal(await handleApi(request('/apiary')), null);
  assert.equal((await call({}, {}, '/api/unknown')).response.status, 404);
  const method = await call({}, { method: 'POST' });
  assert.equal(method.response.status, 405);
  assert.equal(method.response.headers.get('allow'), 'GET, PUT');
});

test('session identity, percent-encoded name and anonymous storage status', async () => {
  const anonymous = await call({}, { user: null }, '/api/session');
  assert.deepEqual(anonymous.body, { authenticated: false, storageAvailable: false });
  const named = await call({ DB: {} }, { headers: {
    'oai-authenticated-user-full-name': encodeURIComponent('Анна Иванова'),
    'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
  } }, '/api/session');
  assert.deepEqual(named.body, { authenticated: true, user: { id: 'site-user-A', email: 'a@example.test', name: 'Анна Иванова' }, storageAvailable: true });
  const malformed = await call({}, { headers: { 'oai-authenticated-user-full-name': '%ZZ', 'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8' } }, '/api/session');
  assert.equal(malformed.body.user.name, 'a@example.test');
});

test('missing identity401 prevents all database access', async () => {
  const env = { DB: { prepare() { assert.fail('Anonymous request reached database'); } } };
  assert.equal((await call(env, { user: null })).response.status, 401);
  assert.equal((await call(env, { user: null, method: 'PUT', body: payload() })).response.status, 401);
});

test('owner pin protects both GET and PUT against cross-tab identity changes', async () => {
  const env = { DB: { prepare() { assert.fail('Owner mismatch reached database'); } } };
  for (const method of ['GET', 'PUT']) {
    const missing = await call(env, { method, ...(method === 'PUT' ? { body: payload() } : {}), headers: { 'X-VetAtlas-Owner': null } });
    assert.equal(missing.response.status, 403);
    const changed = await call(env, { method, user: 'B', ...(method === 'PUT' ? { body: payload() } : {}), headers: { 'X-VetAtlas-Owner': 'site-user-A' } });
    assert.equal(changed.response.status, 409);
    assert.equal(changed.body.error.code, 'identity_changed');
    assert(!Object.hasOwn(changed.body, 'state'));
    assert(!Object.hasOwn(changed.body, 'profile'));
    assert(!Object.hasOwn(changed.body, 'revision'));
  }
});

test('missing or failed DB is explicit503, not success', async () => {
  assert.equal((await call({})).response.status, 503);
  assert.equal((await call({}, { method: 'PUT', body: payload() })).response.status, 503);
  const env = { DB: { prepare() { throw new Error('secret database details'); } } };
  const fail = await call(env);
  assert.equal(fail.response.status, 503);
  assert(!JSON.stringify(fail.body).includes('secret database details'));
});

test('CSRF Origin, cross-site and custom-header rejection403; JSON requirement415', async t => {
  const { env, calls } = database(t);
  const badHeaders = [{ Origin: null }, { Origin: 'https://attacker.example' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'X-VetAtlas-Request': null }, { 'X-VetAtlas-Request': '0' }];
  for (const headers of badHeaders) assert.equal((await call(env, { method: 'PUT', body: payload(), headers })).response.status, 403);
  assert.equal((await call(env, { method: 'PUT', body: payload(), headers: { 'Content-Type': 'text/plain' } })).response.status, 415);
  assert.equal(calls.length, 0);
});

test('initial PUT, normalization, fresh-client GET and A/B database isolation', async t => {
  const { env, sqlite, calls } = database(t);
  const empty = await call(env);
  assert.deepEqual(empty.body, { profile: { displayName: '', group: '' }, state: null, revision: 0, updatedAt: null });
  const first = await call(env, { method: 'PUT', body: payload(0, { state: state({ favorites: ['demodex', 'demodex'], read: { atopy: '2026-11-05T15:00:00+03:00' } }) }) });
  assert.equal(first.response.status, 200);
  assert.equal(first.body.revision, 1);
  assert.deepEqual(first.body.profile, { displayName: 'Анна', group: 'В-261' });
  assert.deepEqual(first.body.state.favorites, ['demodex']);
  assert.equal(first.body.state.read.atopy, date);
  assert(Number.isFinite(Date.parse(first.body.updatedAt)));
  assert.deepEqual((await call(env)).body, first.body);
  assert.equal((await call(env, { user: 'B' })).body.state, null);
  const b = await call(env, { user: 'B', method: 'PUT', body: payload(0, { profile: { displayName: 'Борис', group: '' }, state: state({ notes: { atopy: 'B only' } }) }) });
  assert.equal(b.response.status, 200);
  assert.equal((await call(env)).body.state.notes.atopy, 'Повторить диагностику.');
  assert.equal((await call(env, { user: 'B' })).body.state.notes.atopy, 'B only');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM student_accounts').get().n, 2);
  assert(calls.every(sql => !/\b(?:CREATE|ALTER|DROP)\b/iu.test(sql)));
});

test('atomic CAS conflict returns latest; stale initial create and nonzero missing revision cannot create', async t => {
  const { env, sqlite } = database(t);
  const missing = await call(env, { method: 'PUT', body: payload(8) });
  assert.equal(missing.response.status, 409);
  assert.equal(missing.body.revision, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM student_accounts').get().n, 0);
  const competing = await Promise.all([call(env, { method: 'PUT', body: payload() }), call(env, { method: 'PUT', body: payload() })]);
  assert.deepEqual(competing.map(x => x.response.status).sort(), [200, 409]);
  assert.equal(competing.find(x => x.response.status === 409).body.revision, 1);
  const update = await call(env, { method: 'PUT', body: payload(1, { state: state({ lastArticle: 'diabetes' }) }) });
  assert.equal(update.response.status, 200);
  assert.equal(update.body.revision, 2);
  const conflict = await call(env, { method: 'PUT', body: payload(1) });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.revision, 2);
  assert.equal(conflict.body.state.lastArticle, 'diabetes');
});

test('owner fields never control identity and schema violations422 do not mutate', async t => {
  const { env, sqlite } = database(t);
  const cases = [
    { ...payload(), owner_id: 'site-user-B' },
    { ...payload(), userId: 'site-user-B' },
    payload(0, { profile: { displayName: 'A', group: '', owner_id: 'site-user-B' } }),
    payload(-1), payload(0.5),
    payload(0, { state: state({ read: { not_a_disease: date } }) }),
    payload(0, { state: state({ read: { atopy: '2026-02-30T12:00:00.000Z' } }) }),
    payload(0, { state: state({ read: { atopy: '0000-01-01T00:00:00+01:00' } }) }),
    payload(0, { state: state({ read: { atopy: '9999-12-31T23:59:59-01:00' } }) }),
    payload(0, { state: state({ notes: { atopy: 'x'.repeat(12001) } }) }),
    payload(0, { profile: { displayName: 'x'.repeat(101), group: '' } }),
    payload(0, { profile: { displayName: 'A', group: 'x'.repeat(81) } }),
    payload(0, { state: state({ favorites: ['__proto__'] }) }),
    payload(0, { state: state({ lastArticle: 'mixed' }) }),
    payload(0, { state: state({ results: [{ ...state().results[0], correct: 6 }] }) }),
    payload(0, { state: state({ results: [state().results[0], state().results[0]] }) }),
    payload(0, { state: state({ results: Array.from({ length: 101 }, (_, i) => ({ ...state().results[0], id: `r${i}` })) }) }),
    payload(0, { state: state({ activities: [{ ...state().activities[0], mode: 'unknown' }] }) }),
    payload(0, { state: state({ activities: [{ ...state().activities[0], topic: 'mixed' }] }) }),
    payload(0, { state: state({ activities: Array.from({ length: 201 }, (_, i) => ({ ...state().activities[0], id: `a${i}` })) }) }),
    payload(0, { state: state({ activities: [{ ...state().activities[0], correct: 1.5 }] }) }),
    '{invalid json', new Uint8Array([255]),
  ];
  for (const body of cases) {
    const result = await call(env, { method: 'PUT', body });
    assert.equal(result.response.status, 422, JSON.stringify(body).slice(0, 160));
  }
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM student_accounts').get().n, 0);
});

test('actual and declared request sizes beyond1MiB reject413 without database mutation', async t => {
  const { env, calls } = database(t);
  const actual = await call(env, { method: 'PUT', body: ' '.repeat(1024 * 1024 + 1) });
  assert.equal(actual.response.status, 413);
  const declared = await call(env, { method: 'PUT', body: '{}', headers: { 'Content-Length': String(1024 * 1024 + 1) } });
  assert.equal(declared.response.status, 413);
  assert.equal(calls.length, 0);
});
