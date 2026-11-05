const MAX_BODY_BYTES = 1024 * 1024;
const DISEASE_IDS = new Set([
  'atopy', 'flea', 'contact', 'pemphigus', 'lupus', 'vasculitis',
  'hypothyroidism', 'cushing', 'diabetes', 'alopecia', 'seborrhea', 'acne',
  'furunculosis', 'abscess', 'phlegmon', 'acral', 'vitiligo',
  'uveodermatologic', 'benign', 'malignant', 'actinic', 'demodex',
]);
const ACTIVITY_MODES = new Set(['sequence', 'matching', 'case']);
const ACCOUNT_SELECT = `SELECT display_name, study_group, state_json, revision, updated_at
  FROM student_accounts WHERE owner_id = ?`;
const ACCOUNT_UPSERT = `INSERT INTO student_accounts
  (owner_id, display_name, study_group, state_json, revision, created_at, updated_at)
  SELECT ?, ?, ?, ?, 1, ?, ?
  WHERE (? = 0 OR EXISTS (
    SELECT 1 FROM student_accounts WHERE owner_id = ? AND revision = ?
  ))
  ON CONFLICT(owner_id) DO UPDATE SET
    display_name = excluded.display_name,
    study_group = excluded.study_group,
    state_json = excluded.state_json,
    revision = student_accounts.revision + 1,
    updated_at = excluded.updated_at
  WHERE student_accounts.revision = ?
  RETURNING display_name, study_group, state_json, revision, updated_at`;

class PayloadError extends Error {}

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function error(code, message, status, details = {}, headers = {}) {
  return json({ error: { code, message }, ...details }, status, headers);
}

function identity(request) {
  const id = request.headers.get('oai-authenticated-user-id');
  if (!id || !id.trim()) return null;
  const email = request.headers.get('oai-authenticated-user-email') || null;
  let name = request.headers.get('oai-authenticated-user-full-name');
  if (name && request.headers.get('oai-authenticated-user-full-name-encoding') === 'percent-encoded-utf-8') {
    try { name = decodeURIComponent(name); } catch { name = null; }
  }
  name = typeof name === 'string' && name.trim() ? name.trim() : email || 'Студент';
  return { id, email, name };
}

function object(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PayloadError(`${label}: требуется объект.`);
  }
  const keys = Object.keys(value);
  if (keys.some(key => !allowed.includes(key))) throw new PayloadError(`${label}: неизвестное поле.`);
  if (allowed.some(key => !Object.hasOwn(value, key))) throw new PayloadError(`${label}: отсутствует обязательное поле.`);
  return value;
}

function text(value, limit, label, { singleLine = false, nonempty = false } = {}) {
  if (typeof value !== 'string' || value.length > limit || value.includes('\0')) {
    throw new PayloadError(`${label}: недопустимая строка или превышена длина ${limit}.`);
  }
  if (singleLine && /[\u0000-\u001f\u007f]/u.test(value)) throw new PayloadError(`${label}: требуется одна строка.`);
  const normalized = singleLine ? value.normalize('NFC').trim() : value;
  if (normalized.length > limit || (nonempty && !normalized)) throw new PayloadError(`${label}: недопустимая длина.`);
  return normalized;
}

function disease(value, label, mixed = false) {
  if (typeof value !== 'string' || !(DISEASE_IDS.has(value) || (mixed && value === 'mixed'))) {
    throw new PayloadError(`${label}: неизвестная тема.`);
  }
  return value;
}

function isoDate(value, label) {
  if (typeof value !== 'string' || value.length > 35) throw new PayloadError(`${label}: требуется дата ISO 8601.`);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match) throw new PayloadError(`${label}: требуется дата ISO 8601 с часовым поясом.`);
  const [, y, m, d, hh, mm, ss, zone] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || Number(hh) > 23 || Number(mm) > 59 || Number(ss) > 59 ||
      (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))) {
    throw new PayloadError(`${label}: несуществующая дата.`);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new PayloadError(`${label}: недопустимая дата.`);
  const normalized = date.toISOString();
  if (!/^\d{4}-/u.test(normalized)) throw new PayloadError(`${label}: дата выходит за поддерживаемый диапазон лет.`);
  return normalized;
}

function score(correct, total, maximum, label) {
  if (!Number.isSafeInteger(correct) || !Number.isSafeInteger(total) || total < 1 || total > maximum || correct < 0 || correct > total) {
    throw new PayloadError(`${label}: недопустимое число заданий или ответов.`);
  }
}

function recordId(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
    throw new PayloadError(`${label}: недопустимый идентификатор.`);
  }
  return value;
}

function validateState(input) {
  const state = object(input, ['version', 'read', 'favorites', 'notes', 'results', 'activities', 'lastArticle'], 'state');
  if (state.version !== 1) throw new PayloadError('state.version: поддерживается версия 1.');
  if (!state.read || typeof state.read !== 'object' || Array.isArray(state.read)) throw new PayloadError('state.read: требуется объект.');
  const read = Object.fromEntries(Object.entries(state.read).map(([id, date]) => [disease(id, 'read'), isoDate(date, 'read') ]));
  if (!Array.isArray(state.favorites) || state.favorites.length > DISEASE_IDS.size) throw new PayloadError('favorites: не более 22 тем.');
  const favorites = [...new Set(state.favorites.map(id => disease(id, 'favorites')))];
  if (!state.notes || typeof state.notes !== 'object' || Array.isArray(state.notes)) throw new PayloadError('notes: требуется объект.');
  const notes = Object.fromEntries(Object.entries(state.notes).map(([id, value]) => [disease(id, 'notes'), text(value, 12000, 'notes') ]));
  if (!Array.isArray(state.results) || state.results.length > 100) throw new PayloadError('results: не более 100 попыток.');
  const resultIds = new Set();
  const results = state.results.map(raw => {
    const item = object(raw, ['id', 'topic', 'title', 'correct', 'total', 'date'], 'results[]');
    const id = recordId(item.id, 'results[].id');
    if (resultIds.has(id)) throw new PayloadError('results: повторяющийся идентификатор.');
    resultIds.add(id);
    score(item.correct, item.total, 20, 'results[]');
    return { id, topic: disease(item.topic, 'results[].topic', true), title: text(item.title, 240, 'results[].title', { singleLine: true, nonempty: true }),
      correct: item.correct, total: item.total, date: isoDate(item.date, 'results[].date') };
  });
  if (!Array.isArray(state.activities) || state.activities.length > 200) throw new PayloadError('activities: не более 200 попыток.');
  const activityIds = new Set();
  const activities = state.activities.map(raw => {
    const item = object(raw, ['id', 'topic', 'mode', 'correct', 'total', 'date'], 'activities[]');
    const id = recordId(item.id, 'activities[].id');
    if (activityIds.has(id)) throw new PayloadError('activities: повторяющийся идентификатор.');
    activityIds.add(id);
    if (!ACTIVITY_MODES.has(item.mode)) throw new PayloadError('activities[].mode: неизвестный режим.');
    score(item.correct, item.total, 200, 'activities[]');
    return { id, topic: disease(item.topic, 'activities[].topic'), mode: item.mode, correct: item.correct, total: item.total,
      date: isoDate(item.date, 'activities[].date') };
  });
  const lastArticle = state.lastArticle === null ? null : disease(state.lastArticle, 'lastArticle');
  return { version: 1, read, favorites, notes, results, activities, lastArticle };
}

function validateBody(body) {
  const input = object(body, ['profile', 'state', 'expectedRevision'], 'body');
  const profile = object(input.profile, ['displayName', 'group'], 'profile');
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new PayloadError('expectedRevision: требуется неотрицательное целое число.');
  return {
    profile: { displayName: text(profile.displayName, 100, 'profile.displayName', { singleLine: true }), group: text(profile.group, 80, 'profile.group', { singleLine: true }) },
    state: validateState(input.state), expectedRevision: input.expectedRevision,
  };
}

async function readBody(request) {
  const declared = request.headers.get('Content-Length');
  if (declared && Number(declared) > MAX_BODY_BYTES) return { tooLarge: true };
  const reader = request.body?.getReader();
  if (!reader) throw new PayloadError('Требуется JSON-тело запроса.');
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) { await reader.cancel(); return { tooLarge: true }; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }; }
  catch { throw new PayloadError('Тело запроса должно содержать корректный JSON в UTF-8.'); }
}

function accountPayload(row) {
  if (!row) return { profile: { displayName: '', group: '' }, state: null, revision: 0, updatedAt: null };
  if (!Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error('Invalid stored revision');
  return {
    profile: { displayName: row.display_name, group: row.study_group },
    state: validateState(JSON.parse(row.state_json)), revision: row.revision, updatedAt: row.updated_at,
  };
}

/** Identity headers are supplied by Sites dispatch, never by an application session. */
export async function handleApi(request, env = {}) {
  const url = new URL(request.url);
  if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) return null;
  if (url.pathname !== '/api/session' && url.pathname !== '/api/account') return error('NOT_FOUND', 'API-маршрут не найден.', 404);
  const allowed = url.pathname === '/api/session' ? ['GET'] : ['GET', 'PUT'];
  if (!allowed.includes(request.method)) return error('METHOD_NOT_ALLOWED', 'Метод не поддерживается.', 405, {}, { Allow: allowed.join(', ') });
  const user = identity(request);
  if (url.pathname === '/api/session') return json(user ? { authenticated: true, user, storageAvailable: !!env.DB } : { authenticated: false, storageAvailable: !!env.DB });
  if (!user) return error('AUTHENTICATION_REQUIRED', 'Войдите через ChatGPT, чтобы открыть личный аккаунт.', 401);
  const expectedOwner = request.headers.get('X-VetAtlas-Owner');
  if (!expectedOwner) return error('REQUEST_FORBIDDEN', 'Повторите подключение личного кабинета.', 403);
  if (expectedOwner !== user.id) return error('identity_changed', 'Учётная запись изменилась. Повторите подключение перед загрузкой или сохранением данных.', 409);
  if (request.method === 'PUT') {
    if (request.headers.get('Origin') !== url.origin || request.headers.get('Sec-Fetch-Site')?.toLowerCase() === 'cross-site' || request.headers.get('X-VetAtlas-Request') !== '1') {
      return error('REQUEST_FORBIDDEN', 'Сохранение разрешено только со страницы этого сайта.', 403);
    }
    if (request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      return error('UNSUPPORTED_MEDIA_TYPE', 'Требуется Content-Type: application/json.', 415);
    }
  }
  if (!env.DB) return error('STORAGE_UNAVAILABLE', 'Облачное хранилище пока недоступно. Данные не сохранены в аккаунт.', 503);
  if (request.method === 'GET') {
    try { return json(accountPayload(await env.DB.prepare(ACCOUNT_SELECT).bind(user.id).first())); }
    catch { return error('STORAGE_UNAVAILABLE', 'Не удалось загрузить аккаунт. Повторите попытку.', 503); }
  }
  let input;
  try {
    const body = await readBody(request);
    if (body.tooLarge) return error('PAYLOAD_TOO_LARGE', 'Размер запроса превышает 1 МиБ.', 413);
    input = validateBody(body.value);
  } catch (cause) {
    return error('INVALID_PAYLOAD', cause instanceof PayloadError ? cause.message : 'Не удалось прочитать тело запроса.', 422);
  }
  try {
    const now = new Date().toISOString();
    const row = await env.DB.prepare(ACCOUNT_UPSERT).bind(
      user.id, input.profile.displayName, input.profile.group, JSON.stringify(input.state), now, now,
      input.expectedRevision, user.id, input.expectedRevision, input.expectedRevision,
    ).first();
    if (row) return json(accountPayload(row));
    const latest = accountPayload(await env.DB.prepare(ACCOUNT_SELECT).bind(user.id).first());
    return error('REVISION_CONFLICT', 'На другом устройстве сохранены изменения. Объедините данные и повторите сохранение.', 409, latest);
  } catch { return error('STORAGE_UNAVAILABLE', 'Не удалось сохранить аккаунт. Повторите попытку.', 503); }
}
