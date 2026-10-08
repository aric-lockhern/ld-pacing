// Fast read path for the Lockhern Account Pacing dashboard.
//
// Apps Script (apps-script/Publish.gs) publishes the three payloads the page loads
// on every visit — `data` (Search feed/budgets/dailies), `fb` (Facebook) and `conv`
// (per-conversion-action) — plus a tiny `index` (a SHA-256 of the shared secret)
// to Netlify Blobs. This answers the page's reads from there, on the dashboard's
// own address, instead of Google's slow/flaky web-app front end.
//
// The Sheet + Apps Script stay the source of truth and the only writer. There is
// ONE shared team secret and no per-client scoping (the tool shows everyone the
// same portfolio, exactly as today): a caller presenting that secret gets the
// published snapshot; anything this can't positively verify (nothing published, a
// secret it can't match) answers {ok:false, fallback:true} and the page asks Apps
// Script, which stays the authority. tests/fastapi.test.mjs pins all of it.
import { createHash, timingSafeEqual } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

// GET action -> blob key. Only these reads are served fast; everything else
// (slackUsers, changelog, writes) falls back to Apps Script.
const KINDS = { data: 'data', fbData: 'fb', convData: 'conv' };

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex' }
});
const fail = (error, status = 200) => json({ ok: false, error }, status);
const fallback = (why) => json({ ok: false, fallback: true, error: why });
const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');
// The big payloads are stored and served STILL GZIPPED (the publisher's gzip), with
// Content-Encoding: gzip — a few MB of JSON become a couple hundred KB over the wire,
// well under the function response limit, and the browser decompresses natively.
const GZHEAD = { 'content-type': 'application/json', 'content-encoding': 'gzip', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex' };

export function same(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** GET /api?action=data|fbData|convData|ping&secret=… (the Apps Script params) and POST /api/ingest. */
export async function handle(req, store, env) {
  const url = new URL(req.url);
  if (req.method === 'POST' && url.pathname.replace(/\/$/, '').endsWith('/ingest')) return ingest(req, store, env);
  if (req.method !== 'GET') return fail('Reads only.', 405);
  const p = Object.fromEntries(url.searchParams);
  const ix = await store.get('index', { type: 'json' });

  // ping: whether the Sheet has published yet, so "is fast loading on?" is answerable from a browser.
  if (p.action === 'ping') {
    let accounts = 0, has = { data: false, fb: false, conv: false };
    if (ix) {
      const d = await store.get('data', { type: 'json' });
      has = { data: !!d, fb: !!(await store.get('fb', { type: 'json' })), conv: !!(await store.get('conv', { type: 'json' })) };
      accounts = (d && d.accounts) || 0;
    }
    return json({ ok: true, fast: true, published: !!ix, at: (ix && ix.at) || '', accounts, has });
  }

  if (!ix) return fallback('nothing published yet');
  // Same gate as Code.gs requireSecret: the caller must present the shared secret.
  if (!ix.secretHash || !same(sha256(p.secret || ''), ix.secretHash)) return fallback('not verified here');
  const key = KINDS[p.action];
  if (!key) return fallback('action not served here');            // slackUsers / changelog → Apps Script
  const blob = await store.get(key, { type: 'json' });
  if (!blob || !blob.gz) return fallback(key + ' not published yet');
  // The stored bytes ARE the gzip of the exact Apps Script response, served as-is.
  return new Response(Buffer.from(blob.gz, 'base64'), { status: 200, headers: GZHEAD });
}

/** POST /api/ingest from Apps Script: {kind:'index'|'data'|'fb'|'conv', version, gz: base64(gzip(JSON))}. */
async function ingest(req, store, env) {
  const secret = env.INGEST_SECRET || '';
  const auth = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (secret.length < 24 || !same(auth, secret)) return fail('Not accepted.', 403);   // fails closed with no secret set
  let b;
  try { b = await req.json(); } catch (e) { return fail('Bad body.', 400); }
  let data;
  try { data = JSON.parse(gunzipSync(Buffer.from(String(b.gz || ''), 'base64')).toString('utf8')); } catch (e) { return fail('Bad payload.', 400); }
  if (b.kind === 'index') {
    if (!data || typeof data.secretHash !== 'string' || data.secretHash.length !== 64) return fail('Bad index.', 400);
    await store.setJSON('index', data);
    return json({ ok: true, stored: 'index' });
  }
  if (b.kind === 'data' || b.kind === 'fb' || b.kind === 'conv') {
    if (!data || data.ok !== true) return fail('Bad payload.', 400);   // validated, then kept gzipped for serving
    const accounts = (b.kind === 'data' && data.feeds) ? (data.feeds.Google_Feed || []).length + (data.feeds.Microsoft_Feed || []).length : 0;
    await store.setJSON(b.kind, { version: String(b.version || ''), at: Date.now(), accounts, gz: String(b.gz || '') });
    return json({ ok: true, stored: b.kind });
  }
  return fail('Unknown kind.', 400);
}
