/**
 * FAST LOADING — publishes what the dashboard reads to Netlify Blobs, so the page
 * doesn't wait on Google's web-app front end (measured Oct 2026: the script ran in
 * milliseconds, but requests took 3-50 s and some came back 404 from
 * script.googleusercontent.com).
 * -----------------------------------------------------------------------------
 * Every 5 minutes (a time trigger) `publishAll` sends, to <SITE_URL>/api/ingest
 * (netlify/functions/api.mjs), the three read payloads the page loads on every
 * visit — `data` (the Search feed/budgets/dailies), `fb` (Facebook) and `conv`
 * (per-conversion-action) — but only the ones whose content changed, plus a tiny
 * `index` (a SHA-256 of the shared secret, so the function can check the caller
 * the same way requireSecret does, and never the secret itself).
 *
 * The Sheet and Apps Script stay the source of truth and the only writer: the page
 * only READS from Netlify, and falls back to Apps Script for anything the fast
 * path can't serve (nothing published, a secret it can't verify). A write updates
 * the page optimistically and is reflected on the fast path by the next 5-minute
 * run (passive viewers can be up to ~5 min behind); Refresh always bypasses the
 * fast path and reads the live Sheet.
 *
 * Secret: Script Properties INGEST_SECRET, the same value as the Netlify
 * environment variable INGEST_SECRET (Sheet menu > Fast loading: set up). Nothing
 * is sent until both exist.
 */
var PUB_BUDGET_MS = 4 * 60 * 1000;

function pubSecret_() { return PropertiesService.getScriptProperties().getProperty('INGEST_SECRET') || ''; }
function pubSiteUrl_() { return String(PropertiesService.getScriptProperties().getProperty('SITE_URL') || SITE_URL || '').replace(/\/+$/, ''); }
function pubUrl_() { var s = pubSiteUrl_(); return s ? s + '/api/ingest' : ''; }
function pubOn_() { return !!(pubSecret_() && pubUrl_()); }

function hexDigest_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s)).map(function (b) { return ((b & 0xff) + 0x100).toString(16).slice(1); }).join('');
}

/** POSTs one gzipped payload; returns '' or the reason it failed. */
function pubPost_(kind, version, data) {
  var gz = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(data), 'application/json')).getBytes());
  var res = UrlFetchApp.fetch(pubUrl_(), { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + pubSecret_() }, payload: JSON.stringify({ kind: kind, version: version || '', gz: gz }) });
  var code = res.getResponseCode(), body = {};
  try { body = JSON.parse(res.getContentText()); } catch (e) {}
  return code === 200 && body.ok ? '' : 'HTTP ' + code + (body.error ? ': ' + body.error : '');
}

/** What the fast path needs to verify a caller (no per-client tokens here — one shared secret). */
function pubIndex_() { return { at: Date.now(), secretHash: hexDigest_(SHARED_SECRET), site: pubSiteUrl_() }; }
function publishIndex_() { return pubOn_() ? pubPost_('index', '', pubIndex_()) : ''; }

// The page's three read actions, each built from the SAME functions doGet uses, so
// the published snapshot can't drift from the live read.
var PUB_KINDS = [
  { kind: 'data', vkey: 'PUB_V_data', build: function () { return buildDataResponse_(); } },
  { kind: 'fb',   vkey: 'PUB_V_fb',   build: function () { return fbData({ secret: SHARED_SECRET, fresh: '1' }); } },
  { kind: 'conv', vkey: 'PUB_V_conv', build: function () { return convData({ secret: SHARED_SECRET }); } }
];

/** Builds one kind and sends it only if its content changed. Returns '' or the reason. */
function publishKind_(spec, props) {
  var data = spec.build();
  var version = hexDigest_(JSON.stringify(data));          // content hash → unchanged payloads aren't re-sent
  if (props.getProperty(spec.vkey) === version) return '';
  var err = pubPost_(spec.kind, version, data);
  if (!err) props.setProperty(spec.vkey, version);
  return err;
}

/** Time trigger (every 5 minutes): the index, then each payload whose data changed. */
function publishAll() {
  if (!pubOn_()) return;
  var cache = CacheService.getScriptCache();
  if (cache.get('pub_running')) return;                    // the previous run is still going
  cache.put('pub_running', '1', 300);
  try {
    var props = PropertiesService.getScriptProperties(), started = Date.now();
    var err = publishIndex_();
    if (err) { console.log('Fast loading: index not accepted: ' + err); return; }
    var done = 0, failed = [];
    for (var i = 0; i < PUB_KINDS.length; i++) {
      if (Date.now() - started > PUB_BUDGET_MS) break;
      var e = '';
      try { e = publishKind_(PUB_KINDS[i], props); } catch (ex) { e = String(ex && ex.message ? ex.message : ex); }
      if (e) failed.push(PUB_KINDS[i].kind + ': ' + e); else done++;
    }
    console.log('Fast loading: checked ' + done + ' payload(s)' + (failed.length ? '; failed: ' + failed.join(' | ') : '') + '.');
  } finally {
    cache.remove('pub_running');
  }
}

/** Republish one kind right away (e.g. from the script editor after a bulk change). Never throws. */
function publishSoon_(kind) {
  if (!pubOn_()) return;
  if (CacheService.getScriptCache().get('pub_running')) return;   // the 5-min job is going; it will pick this up
  try {
    var props = PropertiesService.getScriptProperties();
    publishIndex_();
    for (var i = 0; i < PUB_KINDS.length; i++) if (PUB_KINDS[i].kind === kind) { publishKind_(PUB_KINDS[i], props); break; }
  } catch (e) { console.log('Fast loading: could not publish now: ' + e); }
}

/** Sheet menu. */
function onOpen() {
  try { SpreadsheetApp.getUi().createMenu('Lockhern Pacing').addItem('Fast loading: set up', 'fastSetup').addToUi(); } catch (e) {}
}

/** Sheet menu > Fast loading: set up — create the secret, install the trigger, test-send, show Netlify steps. */
function fastSetup() {
  var ui = SpreadsheetApp.getUi(), props = PropertiesService.getScriptProperties();
  if (!pubUrl_()) { ui.alert('SITE_URL is not set (Code.gs SITE_URL or a Script Property), so there is nowhere to publish to.'); return; }
  var secret = pubSecret_();
  if (!secret) { secret = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); props.setProperty('INGEST_SECRET', secret); }
  var have = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  if (have.indexOf('publishAll') < 0) ScriptApp.newTrigger('publishAll').timeBased().everyMinutes(5).create();
  var test = '';
  try { test = publishIndex_(); } catch (e) { test = String(e && e.message ? e.message : e); }
  var html = '<div style="font:14px Arial;padding:4px">' +
    (test ? '<p><b>One step left, in Netlify</b> (Site configuration &gt; Environment variables &gt; Add a variable):</p>' +
       '<p>Key: <b>INGEST_SECRET</b><br>Value:</p><input style="width:100%;padding:6px" value="' + secret + '" onclick="this.select()" readonly>' +
       '<p>Then Deploys &gt; Trigger deploy, wait for it to finish, and run this menu item again.</p>' +
       '<p style="color:#64748b">Test send: ' + String(test).replace(/</g, '&lt;') + '</p>'
     : '<p><b>Fast loading is on.</b> All three payloads are publishing now and then every 5 minutes when something changes. The dashboard reads from Netlify and falls back to Apps Script automatically.</p>') +
    '</div>';
  ui.showModalDialog(HtmlService.createHtmlOutput(html).setWidth(560).setHeight(test ? 320 : 150), 'Fast loading');
}
