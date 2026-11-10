import { createHmac, createHash, timingSafeEqual, randomBytes } from 'node:crypto';

const COOKIE_NAME = 'sas_research_session';
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
const responseHeaders = {
  'cache-control': 'no-store, max-age=0',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {'content-type': 'application/json; charset=utf-8', ...responseHeaders, ...extra}
  });
}

function equalSecret(input, expected) {
  const left = createHash('sha256').update(input).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
}

function getConfiguration() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !/^https:\/\//.test(url)) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return {url: url.replace(/\/$/, ''), key};
}

async function supabaseRpc(name, body = {}) {
  const {url, key} = getConfiguration();
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let result;
  try { result = text ? JSON.parse(text) : null; }
  catch { throw new Error('Invalid database response'); }
  if (!res.ok) {
    // Never leak SQL errors or database secrets to participants.
    throw Object.assign(new Error('Database operation failed'), {internalDetail: result?.message});
  }
  return result;
}

async function allRows() {
  const {url, key} = getConfiguration();
  const rows = [];
  // Fetch in pages because Supabase projects usually cap response size per request.
  for (let start = 0; start < 10000; start += 500) {
    const res = await fetch(`${url}/rest/v1/study_sessions?select=id,version,step,answers,started_at,completed_at&order=started_at.asc&offset=${start}&limit=500`, {
      headers: {apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json'}
    });
    if (!res.ok) throw new Error('Failed to read database');
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < 500) break;
  }
  return rows;
}

function signSession() {
  const raw = Buffer.from(JSON.stringify({exp: Date.now() + EIGHT_HOURS_MS, n: randomBytes(12).toString('hex')})).toString('base64url');
  const sig = createHmac('sha256', process.env.RESEARCHER_SESSION_SECRET).update(raw).digest('base64url');
  return `${raw}.${sig}`;
}

function isResearcher(req) {
  const secret = process.env.RESEARCHER_SESSION_SECRET;
  if (!secret) return false;
  const cookie = req.headers.get('cookie') || '';
  const token = cookie.split(';').map(v => v.trim()).find(v => v.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  if (!token) return false;
  const [raw, signature, extra] = token.split('.');
  if (!raw || !signature || extra) return false;
  const expected = createHmac('sha256', secret).update(raw).digest('base64url');
  if (!equalSecret(signature, expected)) return false;
  try {
    const {exp} = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    return Number.isFinite(exp) && exp > Date.now() && exp < Date.now() + EIGHT_HOURS_MS;
  } catch { return false; }
}

function csvCell(value) {
  const string = value == null ? '' : String(value);
  // Quote CSV fields, also neutralize spreadsheet formula injections.
  const safe = /^[=+@\-\t\r]/.test(string) ? `'${string}` : string;
  return `"${safe.replaceAll('"', '""')}"`;
}

function exportCsv(rows) {
  const headers = ['anonymous_id', 'version', 'status', 'started_at', 'completed_at',
    'scenario1_framing', 'scenario1_choice', 'distraction1', 'distraction2',
    'distraction3', 'distraction4', 'distraction5', 'scenario2_framing', 'scenario2_choice',
    'positive_choice', 'negative_choice'];
  const data = rows.map(r => {
    const completed = Boolean(r.completed_at);
    const answers = r.answers || {};
    const pos = r.version === 'A' ? answers.scenario1 : answers.scenario2;
    const neg = r.version === 'A' ? answers.scenario2 : answers.scenario1;
    return [r.id, r.version, completed ? 'completed' : 'incomplete', r.started_at, r.completed_at,
      r.version === 'A' ? 'positive' : 'negative', answers.scenario1,
      answers.distraction1, answers.distraction2, answers.distraction3,
      answers.distraction4, answers.distraction5,
      r.version === 'A' ? 'negative' : 'positive', answers.scenario2,
      completed ? pos : '', completed ? neg : ''];
  });
  return [headers, ...data].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

async function readBody(req) {
  if (Number(req.headers.get('content-length') || 0) > 2000) throw new Error('Payload too large');
  const text = await req.text();
  if (text.length > 2000) throw new Error('Payload too large');
  try { return text ? JSON.parse(text) : {}; }
  catch { throw new Error('Invalid JSON'); }
}

function validId(id) {
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

export default async function handler(req) {
  const url = new URL(req.url);
  const action = url.pathname.split('/').filter(Boolean).at(-1);
  if (req.method === 'OPTIONS') return new Response(null, {status: 405, headers: responseHeaders});
  if (req.method === 'POST') {
    const origin = req.headers.get('origin');
    if (origin && origin !== url.origin) return json({error: 'Invalid origin'}, 403);
  }
  try {
    if (action === 'start' && req.method === 'POST') {
      const body = await readBody(req);
      if (body.consent !== true) return json({error: 'Consent is required'}, 400);
      return json(await supabaseRpc('start_study'), 201);
    }
    if (action === 'status' && req.method === 'GET') {
      const id = url.searchParams.get('id');
      if (!validId(id)) return json({error: 'Invalid session'}, 400);
      const status = await supabaseRpc('study_status', {p_id: id});
      return status ? json(status) : json({error: 'Session expired or missing'}, 404);
    }
    if (action === 'answer' && req.method === 'POST') {
      const {id, step, choice} = await readBody(req);
      if (!validId(id) || !Number.isInteger(step) || step < 0 || step > 6 || !['A','B'].includes(choice))
        return json({error: 'Invalid answer'}, 400);
      try { return json(await supabaseRpc('study_answer', {p_id: id, p_step: step, p_choice: choice})); }
      catch (error) {
        if (/OUT_OF_SEQUENCE|SESSION_NOT_FOUND|INVALID_ANSWER/.test(error.internalDetail || ''))
          return json({error: 'This question has already been answered or your session expired. Refresh to continue.'}, 409);
        throw error;
      }
    }
    if (action === 'withdraw' && req.method === 'POST') {
      const {id} = await readBody(req);
      if (!validId(id)) return json({error: 'Invalid session'}, 400);
      return json({deleted: await supabaseRpc('study_withdraw', {p_id: id})});
    }
    if (action === 'login' && req.method === 'POST') {
      const {password} = await readBody(req);
      if (!process.env.RESEARCHER_PASSWORD || !process.env.RESEARCHER_SESSION_SECRET)
        return json({error: 'Researcher access is not configured'}, 503);
      if (typeof password !== 'string' || !equalSecret(password, process.env.RESEARCHER_PASSWORD))
        return json({error: 'Incorrect password'}, 401);
      return json({ok: true}, 200, {
        'set-cookie': `${COOKIE_NAME}=${signSession()}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=${EIGHT_HOURS_MS / 1000}`
      });
    }
    if (action === 'logout' && req.method === 'POST') {
      return json({ok: true}, 200, {
        'set-cookie': `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0`
      });
    }
    if (action === 'research' && req.method === 'GET') {
      if (!isResearcher(req)) return json({error: 'Researcher login required'}, 401);
      return json({sessions: await allRows()});
    }
    if (action === 'export' && req.method === 'GET') {
      if (!isResearcher(req)) return json({error: 'Researcher login required'}, 401);
      return new Response(exportCsv(await allRows()), {
        headers: {
          ...responseHeaders,
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': 'attachment; filename="sas-framing-study-responses.csv"'
        }
      });
    }
    return json({error: 'Not found'}, 404);
  } catch (error) {
    // Log only non-sensitive diagnostic information server-side.
    console.error('Study API error:', error.message, error.internalDetail || '');
    return json({error: 'Something went wrong. Please try again or contact the researchers.'}, 500);
  }
}

// Netlify routes all /api/... requests to this single server-side handler.
export const config = { path: "/api/*" };
