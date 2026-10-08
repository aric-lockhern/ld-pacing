// The fast read path must answer exactly what the publisher sends, serve only a
// caller that presents the shared secret, and fall back for anything it can't
// vouch for. The publisher (apps-script/Publish.gs) is run for real — evaluated
// with stubbed Apps Script globals — POSTing through the real function into an
// in-memory Blobs store, then read back and compared.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { handle } from '../netlify/lib/fastapi.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SECRET = 'x'.repeat(40);                 // INGEST_SECRET (>= 24 chars)
const SHARED = 'lockhern-pacing';              // the page's shared secret
const SITE = 'https://pacing.example.com';
const plain = (x) => JSON.parse(JSON.stringify(x));

// In-memory Netlify Blobs store (mirrors getStore: get({type:'json'}) + setJSON).
function memStore() {
  const m = new Map();
  return { m, get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), setJSON: async (k, v) => { m.set(k, JSON.stringify(v)); } };
}

// Sample builder outputs — the exact shapes doGet returns for data / fbData / convData.
function builders() {
  return {
    data: {
      ok: true,
      feeds: { Google_Feed: [{ Client: 'Apex', AccountId: '1', MTD_Spend: 100 }], Microsoft_Feed: [] },
      budgets: [{ Client: 'Apex', Month: '2026-10', Amount: 500 }],
      groups: [], dismissals: [], team: [], remindersDismissed: [],
      dailies: { Daily_Google: [{ Client: 'Apex', Date: '2026-10-01', Spend: 10 }], Daily_Microsoft: [] }
    },
    fb: { ok: true, rows: [{ a: 'FB Acct', c: 'Camp', cost: 5 }], accounts: [{ account: 'FB Acct', active: true }], budgets: [] },
    conv: { ok: true, convActions: { Google: [{ Client: 'Apex', Action: 'Purchase', Conv: 3 }], Microsoft: [] }, convPrefs: [] }
  };
}

// Evaluate the real Publish.gs with stubbed Apps Script globals; the stub fetch
// POSTs through the real function (handle) into the store. Returns the live sandbox.
function world(opts = {}) {
  const store = memStore(), env = { INGEST_SECRET: opts.env === undefined ? SECRET : opts.env };
  const props = new Map(); if (opts.propSecret !== '') props.set('INGEST_SECRET', opts.propSecret || SECRET);
  const cache = new Map();
  const b = builders();
  const built = { data: () => b.data, fb: () => b.fb, conv: () => b.conv };
  const sent = []; let kindPosts = 0;

  const Utilities = {
    DigestAlgorithm: { SHA_256: 'sha256' },
    computeDigest: (_alg, s) => Array.from(crypto.createHash('sha256').update(String(s)).digest()),
    base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
    newBlob: (str) => ({ _b: Buffer.from(String(str), 'utf8'), getBytes() { return this._b; } }),
    gzip: (blob) => ({ _b: zlib.gzipSync(blob.getBytes()), getBytes() { return this._b; } }),
    getUuid: () => crypto.randomUUID()
  };
  const UrlFetchApp = {
    fetch: (url, opt) => {
      const body = JSON.parse(opt.payload);
      if (body.kind !== 'index') kindPosts++;
      const req = new Request(url, { method: 'POST', headers: { authorization: opt.headers.Authorization, 'content-type': 'application/json' }, body: opt.payload });
      sent.push(handle(req, store, env));
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ ok: true }) };   // optimistic, like Apps Script sees
    }
  };
  const ctx = {
    console,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => props.set(k, v) }) },
    CacheService: { getScriptCache: () => ({ get: (k) => (cache.has(k) ? cache.get(k) : null), put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k) }) },
    Utilities, UrlFetchApp,
    SHARED_SECRET: SHARED, SITE_URL: SITE,
    buildDataResponse_: built.data, fbData: built.fb, convData: built.conv
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(HERE, '../apps-script/Publish.gs'), 'utf8'), ctx);

  const flush = () => Promise.all(sent.splice(0));
  const fast = async (q) => {
    const r = await handle(new Request(SITE + '/api?' + new URLSearchParams(q)), store, env);
    const buf = Buffer.from(await r.arrayBuffer());
    // Big payloads come back gzipped (Content-Encoding: gzip) — a browser decompresses
    // transparently; here we do it by hand. Small JSON (fallback/ping) is plain.
    const text = r.headers.get('content-encoding') === 'gzip' ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
    return { status: r.status, body: JSON.parse(text) };
  };
  return { ctx, store, env, flush, fast, builders: b, kindPosts: () => kindPosts, resetPosts: () => { kindPosts = 0; } };
}
async function published(opts) { const w = world(opts); w.ctx.publishAll(); await w.flush(); return w; }

test('the publisher sends the index and all three payloads; nothing without the secret', async () => {
  const w = await published();
  assert.ok(w.store.m.has('index'));
  assert.ok(w.store.m.has('data') && w.store.m.has('fb') && w.store.m.has('conv'));
  const ix = JSON.parse(w.store.m.get('index'));
  assert.equal(ix.secretHash, crypto.createHash('sha256').update(SHARED).digest('hex'));
  assert.ok(!JSON.stringify(ix).includes(SHARED), 'the shared secret itself never leaves the script, only its hash');

  // Unchanged payloads are not re-sent.
  w.resetPosts(); w.ctx.publishAll(); await w.flush();
  assert.equal(w.kindPosts(), 0, 'nothing changed → no payload re-sent');

  // A data change re-sends only that payload.
  w.builders.data.budgets[0].Amount = 999; w.resetPosts(); w.ctx.publishAll(); await w.flush();
  assert.equal(w.kindPosts(), 1, 'only the changed payload is re-sent');

  // With no INGEST_SECRET in Script Properties, the publisher sends nothing.
  const off = world({ propSecret: '' });
  off.ctx.publishAll(); await off.flush();
  assert.equal(off.store.m.size, 0, 'no secret → nothing published');
});

test('a caller with the shared secret gets exactly what was published; same shape as doGet', async () => {
  const w = await published();
  for (const [action, key] of [['data', 'data'], ['fbData', 'fb'], ['convData', 'conv']]) {
    const f = await w.fast({ action, secret: SHARED });
    assert.equal(f.body.ok, true, action);
    const got = Object.assign({}, f.body); delete got._fast; delete got._at;
    assert.deepEqual(got, plain(w.builders[key]), action + ' round-trips unchanged');
  }
});

test('SECURITY: the fast path never serves a caller it cannot verify', async () => {
  const w = await published();
  // Wrong or missing secret → fallback (the page then asks Apps Script), never data.
  for (const q of [{ action: 'data', secret: 'wrong' }, { action: 'data' }, { action: 'data', secret: '' }]) {
    const r = await w.fast(q);
    assert.equal(r.body.ok, false, JSON.stringify(q));
    assert.equal(r.body.fallback, true);
    assert.equal(r.body.feeds, undefined, 'no data leaks on a bad secret');
  }
  // Actions the fast path does not serve fall back to Apps Script.
  assert.equal((await w.fast({ action: 'slackUsers', secret: SHARED })).body.fallback, true);
  assert.equal((await w.fast({ action: 'changelog', secret: SHARED })).body.fallback, true);
});

test('ingest refuses a wrong, missing, short, or unset secret; accepts the right one', async () => {
  const w = world();
  const gz = zlib.gzipSync(JSON.stringify({ secretHash: 'a'.repeat(64) })).toString('base64');
  const post = (auth, env = w.env) => handle(new Request(SITE + '/api/ingest', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'index', gz }) }), w.store, env);
  assert.equal((await post('Bearer wrong')).status, 403);
  assert.equal((await post('')).status, 403);
  assert.equal((await post('Bearer ' + SECRET.slice(0, -1))).status, 403, 'a secret one char short is refused');
  assert.equal((await post('Bearer ' + SECRET, { INGEST_SECRET: '' })).status, 403, 'no INGEST_SECRET on Netlify → refuse everything');
  assert.equal((await post('Bearer short')).status, 403, 'a secret under 24 chars is refused');
  assert.equal((await post('Bearer ' + SECRET)).status, 200);
  // Writes only.
  assert.equal((await handle(new Request(SITE + '/api?action=ping', { method: 'DELETE' }), w.store, w.env)).status, 405);
});

test('before anything is published, every read falls back; ping reports status without leaking', async () => {
  const w = world();
  assert.equal((await w.fast({ action: 'data', secret: SHARED })).body.fallback, true);
  const p0 = (await w.fast({ action: 'ping' })).body;
  assert.equal(p0.published, false, 'ping says nothing is published yet');

  const pub = await published();
  const p1 = (await pub.fast({ action: 'ping' })).body;
  assert.ok(p1.published && p1.at, 'ping says the Sheet has published and when');
  assert.deepEqual(p1.has, { data: true, fb: true, conv: true });
  assert.equal(p1.accounts, 1, 'ping counts the published feed accounts');
  assert.ok(!JSON.stringify(p1).includes('lockhern-pacing'), 'ping never includes the secret');
});
