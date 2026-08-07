/**
 * LOCKHERN — Sheet gateway (Google Apps Script web app)
 * ------------------------------------------------------------------
 * One web app that the whole system talks to, so the SHEET STAYS PRIVATE
 * (only this script, running as you, ever reads it):
 *
 *   • doPost                     ← Microsoft feed writes (from the Bing script)
 *   • doGet ?action=data         → returns Google_Feed + Microsoft_Feed + Budgets (JSONP)
 *   • doGet ?action=setBudget    → saves one budget (JSONP)
 *
 * DEPLOY (first time):
 *   script.google.com → New project → paste this → Save →
 *   Deploy → New deployment → Web app → Execute as: Me · Who has access: Anyone
 *   → copy the /exec URL into WEBAPP_URL in BOTH the Bing script and index.html.
 *
 * AFTER ANY EDIT you must publish a NEW VERSION or the /exec URL keeps serving
 * the old code: Deploy → Manage deployments → (pencil) → Version: New version → Deploy.
 *
 * SECRETS: the real Slack webhook URL + bot token are stored in this project's
 * SCRIPT PROPERTIES, not in this file (GitHub secret scanning blocks committing
 * them, and a public web app must not carry live credentials). They survive
 * every redeploy. Set them ONCE, either way:
 *   • Project Settings → Script properties → add SLACK_WEBHOOK_URL and
 *     SLACK_BOT_TOKEN, or
 *   • paste them into saveSlackSecrets() below, Run it once, then blank them.
 * The constants below are only inert fallbacks for the repo copy.
 * ------------------------------------------------------------------ */

var SPREADSHEET_ID = '19AOeg1RK0O09hJQpU1ItDRnYBEuNg2aGnyWzpgv_Sqk';
var SHARED_SECRET  = 'lockhern-pacing'; // change this; match it in the Bing script and index.html
var FEED_TABS      = ['Google_Feed', 'Microsoft_Feed'];
var BUDGET_TAB     = 'Budgets';
var BUDGET_HEADER  = ['Client', 'Month', 'Mode', 'Amount', 'Updated'];
var GROUP_TAB      = 'Groups';
var GROUP_HEADER   = ['AccountId', 'Platform', 'Account', 'Group', 'Hidden', 'Type', 'Manager', 'Updated', 'Discipline'];
var DISMISS_TAB    = 'Dismissals';
var DISMISS_HEADER = ['Client', 'Until', 'Updated'];
var CHANGELOG_TAB    = 'Changelog';
var CHANGELOG_HEADER = ['When', 'By', 'Area', 'Action', 'Target', 'Detail'];
var REMIND_TAB       = 'Reminders';                      // team-wide "budget reminder dismissed" per month
var REMIND_HEADER    = ['Month', 'By', 'When'];
var SLACK_WEBHOOK_URL = 'REDACTED_SET_IN_DEPLOYED_SCRIPT'; // fallback only — real value lives in Script property SLACK_WEBHOOK_URL
var SLACK_BOT_TOKEN   = 'REDACTED_SET_IN_DEPLOYED_SCRIPT'; // fallback only — real value lives in Script property SLACK_BOT_TOKEN

// Prefer a Script property; fall back to the constant above. This keeps the
// live secrets out of the repo AND makes them survive redeploys from the repo.
function scriptProp_(key, fallback) {
  try { var v = PropertiesService.getScriptProperties().getProperty(key); if (v && String(v).trim()) return v; } catch (e) {}
  return fallback;
}
function slackWebhookUrl_() { return scriptProp_('SLACK_WEBHOOK_URL', SLACK_WEBHOOK_URL); }
function slackBotToken_()   { return scriptProp_('SLACK_BOT_TOKEN',   SLACK_BOT_TOKEN); }

// One-time setup helper. Paste your real values, Run this once from the editor,
// then blank them out again. (Or add the two Script properties in Project
// Settings and skip this entirely.)
function saveSlackSecrets() {
  var WEBHOOK = ''; // e.g. https://hooks.slack.com/services/XXX/YYY/ZZZ
  var TOKEN   = ''; // e.g. xoxb-...
  var props = PropertiesService.getScriptProperties();
  if (WEBHOOK) props.setProperty('SLACK_WEBHOOK_URL', WEBHOOK);
  if (TOKEN)   props.setProperty('SLACK_BOT_TOKEN', TOKEN);
  Logger.log('Saved ' + (WEBHOOK ? 'webhook ' : '') + (TOKEN ? 'token' : '') + ' to Script properties — now blank the values above.');
}

/* ---- automatic budget alerts (daily timer; see installBudgetAlertTrigger) ----
   Fires once per account per month per tier, so the channel never gets spammed.
   Run previewBudgetAlerts() from the editor to see what WOULD send, safely. */
var ALERT_TIERS = [
  { at: 0.97, key: 'approaching', icon: '⚠️', word: 'is at' },
  { at: 1.00, key: 'over',        icon: '🚨', word: 'has blown past' }
];
var NOTIFIED_TAB    = 'Notified';
var NOTIFIED_HEADER = ['Client', 'Month', 'Tier', 'Pct', 'Sent'];
var ACTIVE_LABEL    = 'active';
var APP_URL         = 'https://pacing.lockherndigital.com';
var MIN_DAYS_LEFT   = 1;   // no alerts on the last day — 97% then is just good pacing
var RATE_DAYS_G     = 3;   // recent-rate window for the "trending to" line

/* ---- Facebook feed (a SEPARATE spreadsheet, campaign-level by date) ----
   The gateway runs as you, so it can read this as long as your Google
   account has access to it. Only rows whose "Active" column = "Active" are
   served, so unmanaged accounts never reach the browser. */
var FB_SPREADSHEET_ID = '1ealb9ssXKqspG204VubWJvkbd77A8_jVfege3uUNS20';
var FB_TAB            = 'FB - Daily';
var FB_LOOKBACK_DAYS  = 95;                 // trim payload to a rolling window
var FB_MAX_ROWS       = 120000;             // safety cap on rows read (newest at the bottom)
var FB_CACHE_SECS     = 300;                // cache the heavy FB read for 5 min
var FB_BUDGET_TAB     = 'Facebook_Budgets'; // stored in the MAIN (private) sheet
var FB_BUDGET_HEADER  = ['Account', 'Campaign', 'Month', 'Mode', 'Amount', 'Updated'];
var FB_ACCTS_TAB      = 'Facebook_Accounts'; // tool-managed active flag + display rename, keyed by account (MAIN sheet)
var FB_ACCTS_HEADER   = ['Account', 'Active', 'Name', 'Updated'];

function doGet(e) {
  var p = (e && e.parameter) || {};
  var out;
  try {
    if (p.action === 'data') {
      requireSecret(p);
      var budgets = readTab(BUDGET_TAB).map(function (r) { r.Month = normMonth(r.Month); return r; });
      out = { ok: true, feeds: readFeeds(), budgets: budgets, groups: readTab(GROUP_TAB), dismissals: readTab(DISMISS_TAB), team: readTab('Team'),
              remindersDismissed: readTab(REMIND_TAB).map(function (r) { return normMonth(r.Month); }).filter(Boolean),
              dailies: { Daily_Google: readTab('Daily_Google').concat(readTab('Daily_Google_WL')), Daily_Microsoft: readTab('Daily_Microsoft').concat(readTab('Daily_Microsoft_WL')) } };
    } else if (p.action === 'setBudget') {
      out = setBudget(p);
    } else if (p.action === 'setGroup') {
      out = setGroup(p);
    } else if (p.action === 'setHidden') {
      out = setHidden(p);
    } else if (p.action === 'setType') {
      out = setType(p);
    } else if (p.action === 'setManager') {
      out = setManager(p);
    } else if (p.action === 'setDismiss') {
      out = setDismiss(p);
    } else if (p.action === 'postSlack') {
      out = postSlack(p);
    } else if (p.action === 'slackUsers') {
      out = slackUsers(p);
    } else if (p.action === 'fbData') {
      out = fbData(p);
    } else if (p.action === 'setFbBudget') {
      out = setFbBudget(p);
    } else if (p.action === 'setFbActive') {
      out = setFbActive(p);
    } else if (p.action === 'setFbRename') {
      out = setFbRename(p);
    } else if (p.action === 'setDiscipline') {
      out = setDiscipline(p);
    } else if (p.action === 'changelog') {
      out = changelog(p);
    } else if (p.action === 'setReminderDismiss') {
      out = setReminderDismiss(p);
    } else {
      out = { ok: true, service: 'Lockhern pacing gateway' };
    }
  } catch (err) {
    out = { ok: false, error: String(err) };
  }
  return reply(out, p.callback);
}

function doPost(e) {
  var p = (e && e.parameter) || {};
  var out;
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.secret !== SHARED_SECRET) throw new Error('bad secret');
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(body.tab) || ss.insertSheet(body.tab);
    var header = body.header || [];
    var rows = body.rows || [];

    if (body.mode === 'replace') {
      sheet.clearContents();
      if (header.length) sheet.getRange(1, 1, 1, header.length).setValues([header]);
      if (rows.length) sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
    } else {
      ensureHeader(sheet, header);
      var values = sheet.getDataRange().getValues();
      rows.forEach(function (row) {
        var t = -1;
        for (var i = 1; i < values.length; i++) {
          if (String(values[i][2]) === String(row[2])) { t = i + 1; break; }
        }
        if (t === -1) sheet.appendRow(row);
        else sheet.getRange(t, 1, 1, row.length).setValues([row]);
      });
    }
    out = { ok: true, wrote: rows.length, tab: body.tab };
  } catch (err) {
    out = { ok: false, error: String(err) };
  }
  return reply(out, p.callback);
}

/* ---- budgets ---- */
function setBudget(p) {
  requireSecret(p);
  var client = String(p.client || '').trim();
  var month = normMonth(p.month);
  if (!client || !month) throw new Error('missing client/month');

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(BUDGET_TAB) || ss.insertSheet(BUDGET_TAB);
  ensureHeader(sheet, BUDGET_HEADER);

  // find every row for this client+month (there may be dupes from the old bug)
  var values = sheet.getDataRange().getValues();
  var matches = [];
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === client && normMonth(values[i][1]) === month) matches.push(i + 1);
  }

  var row = [client, month, (p.mode === 'lastMonth' ? 'lastMonth' : 'manual'), Number(p.amount) || 0, new Date().toISOString()];
  var writeRow;
  if (matches.length === 0) {
    sheet.appendRow(row);
    writeRow = sheet.getLastRow();
  } else {
    writeRow = matches[0];                                   // keep the first
    for (var k = matches.length - 1; k >= 1; k--) sheet.deleteRow(matches[k]); // remove dupes, bottom-up
    sheet.getRange(writeRow, 1, 1, row.length).setValues([row]);
  }
  // keep Month as TEXT so Sheets never turns "2026-07" into a date again
  sheet.getRange(writeRow, 2).setNumberFormat('@');
  sheet.getRange(writeRow, 2).setValue(month);

  logChange_(p.by, 'Search', 'Budget', client, month + ' · ' + (p.mode === 'lastMonth' ? 'last month' : 'manual') + ' · $' + (Number(p.amount) || 0));
  return { ok: true, row: writeRow, deduped: matches.length > 1 ? matches.length - 1 : 0 };
}

// Always return a clean "YYYY-MM", whether the cell is text, an ISO string, or a Date.
function normMonth(v) {
  if (v == null) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return v.getFullYear() + '-' + ('0' + (v.getMonth() + 1)).slice(-2);
  }
  var s = String(v).trim();
  var m = s.match(/^(\d{4})-(\d{1,2})/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2);
  return s;
}

/* ---- account meta: grouping / rename (Group) + hide (Hidden) ---- */
function upsertMeta(id, platform, account, patch) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(GROUP_TAB) || ss.insertSheet(GROUP_TAB);
  ensureHeader(sheet, GROUP_HEADER);
  var values = sheet.getDataRange().getValues();
  var target = -1, existing = null;
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === id) { target = i + 1; existing = values[i]; break; }
  }
  var group      = (patch.group      !== undefined) ? patch.group      : (existing ? existing[3] : '');
  var hidden     = (patch.hidden     !== undefined) ? patch.hidden     : (existing ? existing[4] : '');
  var type       = (patch.type       !== undefined) ? patch.type       : (existing ? existing[5] : '');
  var manager    = (patch.manager    !== undefined) ? patch.manager    : (existing ? existing[6] : '');
  var discipline = (patch.discipline !== undefined) ? patch.discipline : (existing ? existing[8] : '');
  var plat    = platform || (existing ? existing[1] : '');
  var acct    = account  || (existing ? existing[2] : '');
  var row = [id, plat, acct, String(group || ''), String(hidden || ''), String(type || ''), String(manager || ''), new Date().toISOString(), String(discipline || '')];
  var writeRow;
  if (target === -1) { sheet.appendRow(row); writeRow = sheet.getLastRow(); }
  else { writeRow = target; sheet.getRange(writeRow, 1, 1, row.length).setValues([row]); }
  sheet.getRange(writeRow, 1).setNumberFormat('@');
  sheet.getRange(writeRow, 1).setValue(id);
  return { ok: true };
}
function setManager(p) {
  requireSecret(p);
  var id = String(p.accountId || '').trim();
  if (!id) throw new Error('missing accountId');
  var res = upsertMeta(id, p.platform, p.account, { manager: String(p.manager || '') });
  logChange_(p.by, 'Search', 'Manager', p.account || id, String(p.manager || '').split('|')[0] || '(cleared)');
  return res;
}
function setGroup(p) {
  requireSecret(p);
  var id = String(p.accountId || '').trim();
  if (!id) throw new Error('missing accountId');
  var res = upsertMeta(id, p.platform, p.account, { group: p.group || '' });
  logChange_(p.by, 'Search', p.group ? 'Group / rename' : 'Ungroup', p.account || id, String(p.group || ''));
  return res;
}
function setHidden(p) {
  requireSecret(p);
  var id = String(p.accountId || '').trim();
  if (!id) throw new Error('missing accountId');
  var h = (String(p.hidden) === '1' || String(p.hidden) === 'true') ? '1' : '';
  var res = upsertMeta(id, p.platform, p.account, { hidden: h });
  logChange_(p.by, 'Search', h ? 'Hide' : 'Unhide', p.account || id, '');
  return res;
}
function setType(p) {
  requireSecret(p);
  var id = String(p.accountId || '').trim();
  if (!id) throw new Error('missing accountId');
  var t = (p.type === 'ecomm' || p.type === 'leadgen') ? p.type : '';
  var res = upsertMeta(id, p.platform, p.account, { type: t });
  logChange_(p.by, 'Search', 'Type', p.account || id, t || '(cleared)');
  return res;
}
// Budget discipline: 'strict' (hold to budget) or 'fluid' (over/under is ok).
function setDiscipline(p) {
  requireSecret(p);
  var id = String(p.accountId || '').trim();
  if (!id) throw new Error('missing accountId');
  var d = (p.discipline === 'strict' || p.discipline === 'fluid') ? p.discipline : '';
  var res = upsertMeta(id, p.platform, p.account, { discipline: d });
  logChange_(p.by, 'Search', 'Budget discipline', p.account || id, d || '(cleared)');
  return res;
}

/* ---- change log: every tool-applied change is appended here ---- */
function logChange_(by, area, action, target, detail) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(CHANGELOG_TAB) || ss.insertSheet(CHANGELOG_TAB);
    ensureHeader(sheet, CHANGELOG_HEADER);
    sheet.appendRow([new Date().toISOString(), String(by || '').slice(0, 60), String(area || ''),
                     String(action || ''), String(target || '').slice(0, 160), String(detail || '').slice(0, 240)]);
  } catch (e) {}   // logging must never break the actual write
}
function changelog(p) {
  requireSecret(p);
  var rows = readTab(CHANGELOG_TAB);
  var start = Math.max(0, rows.length - 200);
  return { ok: true, entries: rows.slice(start).reverse() };   // newest first, last 200
}
// Dismiss the "update this month's budgets" reminder for the whole team.
function setReminderDismiss(p) {
  requireSecret(p);
  var month = normMonth(p.month);
  if (!month) throw new Error('missing month');
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(REMIND_TAB) || ss.insertSheet(REMIND_TAB);
  ensureHeader(sheet, REMIND_HEADER);
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) { if (normMonth(values[i][0]) === month) return { ok: true, already: true }; }
  sheet.appendRow([month, String(p.by || '').slice(0, 60), new Date().toISOString()]);
  var r = sheet.getLastRow();
  sheet.getRange(r, 1).setNumberFormat('@'); sheet.getRange(r, 1).setValue(month);
  logChange_(p.by, 'Tool', 'Dismiss month reminder', month, '');
  return { ok: true };
}

/* ---- alert dismissals (Client → Until date) ---- */
function setDismiss(p) {
  requireSecret(p);
  var client = String(p.client || '').trim();
  if (!client) throw new Error('missing client');
  var until = String(p.until || '').trim();
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(DISMISS_TAB) || ss.insertSheet(DISMISS_TAB);
  ensureHeader(sheet, DISMISS_HEADER);
  var values = sheet.getDataRange().getValues();
  var target = -1;
  for (var i = 1; i < values.length; i++) { if (String(values[i][0]).trim() === client) { target = i + 1; break; } }
  var row = [client, until, new Date().toISOString()];
  if (target === -1) { sheet.appendRow(row); target = sheet.getLastRow(); }
  else sheet.getRange(target, 1, 1, row.length).setValues([row]);
  sheet.getRange(target, 2).setNumberFormat('@');
  sheet.getRange(target, 2).setValue(until);
  logChange_(p.by, 'Search', until ? 'Dismiss alert' : 'Restore alert', client, until ? ('until ' + until) : '');
  return { ok: true };
}

/* ---- Slack: post a note to #pacing ---- */
// Run this once from the editor (Run ▸ testSlack) to grant the internet
// permission and confirm the webhook works — it should post a test line to #pacing.
function testSlack() {
  var res = UrlFetchApp.fetch(slackWebhookUrl_(), {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ text: 'Pacing gateway test ✅' }), muteHttpExceptions: true
  });
  Logger.log(res.getResponseCode() + ' ' + res.getContentText());
}
function postSlack(p) {
  requireSecret(p);
  var text = String(p.text || '');
  if (!text) throw new Error('empty message');
  return slackSend(text);
}
function slackSend(text) {
  var webhook = slackWebhookUrl_();
  if (webhook.indexOf('http') !== 0) throw new Error('Slack webhook not set in the gateway — add the SLACK_WEBHOOK_URL Script property (Project Settings), then redeploy a new version');
  var res = UrlFetchApp.fetch(webhook, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ text: text }), muteHttpExceptions: true
  });
  return { ok: res.getResponseCode() === 200, code: res.getResponseCode(), body: res.getContentText() };
}

/* ---- Slack: list active workspace members (for the manager picker) ---- */
function slackUsers(p) {
  requireSecret(p);
  var token = slackBotToken_();
  if (token.indexOf('xox') !== 0) throw new Error('Slack bot token not set in the gateway');
  var cache = CacheService.getScriptCache();
  var hit = cache.get('slackUsers');
  if (hit) return { ok: true, users: JSON.parse(hit), cached: true };

  var out = [], cursor = '', guard = 0;
  do {
    var url = 'https://slack.com/api/users.list?limit=200' + (cursor ? ('&cursor=' + encodeURIComponent(cursor)) : '');
    var res = UrlFetchApp.fetch(url, { method: 'get', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    var j = JSON.parse(res.getContentText());
    if (!j.ok) throw new Error('Slack: ' + (j.error || 'error'));
    (j.members || []).forEach(function (m) {
      if (m.deleted || m.is_bot || m.id === 'USLACKBOT') return;
      var pr = m.profile || {};
      out.push({ name: pr.display_name || pr.real_name || m.name || m.id, id: m.id });
    });
    cursor = (j.response_metadata && j.response_metadata.next_cursor) || '';
  } while (cursor && ++guard < 25);

  out.sort(function (a, b) { return a.name.localeCompare(b.name); });
  try { cache.put('slackUsers', JSON.stringify(out), 1800); } catch (e) {} // 30 min; skips if too large
  return { ok: true, users: out };
}

/* ============================================================
   AUTOMATIC BUDGET ALERTS
   Run on a daily timer. Posts to #pacing when an account crosses
   97% of its budget (and again if it passes 100%), tagging the
   assigned manager. Once per account per month per tier.

   SETUP: Run installBudgetAlertTrigger() once from the editor.
   TEST:  Run previewBudgetAlerts() — logs, sends nothing.
   ============================================================ */
function runBudgetAlerts()     { return budgetAlertPass(false); }  // trigger entry point
function previewBudgetAlerts() { return budgetAlertPass(true);  }  // dry run

function budgetAlertPass(dryRun) {
  var now = new Date();
  var month = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2);
  var dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  var toGo = dim - now.getDate();              // days after today
  var remaining = dim - now.getDate() + 1;     // incl. today, for projecting
  if (toGo < MIN_DAYS_LEFT) { Logger.log('Skipped — only ' + toGo + ' day(s) left in the month.'); return; }

  var meta = readGroupMeta();
  var clients = buildClientTotals(meta);
  var budgets = readBudgetsFor(month);
  var daily = readDailyByClient(meta, month);
  var sent = readNotified();
  var posted = 0, checked = 0;

  for (var name in clients) {
    var c = clients[name];
    if (c.hidden) continue;                                  // manually hidden
    if (meta.anyLabels && !c.active) continue;               // not an Active account
    var b = budgets[name];
    if (!b) continue;                                        // no budget set this month
    var eff = (b.mode === 'lastMonth') ? c.lastMonth : b.amount;
    if (!(eff > 0)) continue;
    checked++;

    var pct = c.spend / eff, tier = null, ti = -1;
    for (var i = ALERT_TIERS.length - 1; i >= 0; i--) {
      if (pct >= ALERT_TIERS[i].at) { tier = ALERT_TIERS[i]; ti = i; break; }
    }
    if (!tier) continue;
    if (sent[name + '|' + month + '|' + tier.key]) continue; // already told them

    var text = budgetAlertText(name, c, eff, pct, tier, toGo, daily[name], remaining);
    if (dryRun) { Logger.log('WOULD SEND >> ' + text); }
    else {
      slackSend(text);
      // mark this tier and any lower ones, so a jump past 100% doesn't also fire "approaching"
      for (var j = 0; j <= ti; j++) {
        if (sent[name + '|' + month + '|' + ALERT_TIERS[j].key]) continue;
        markNotified(name, month, ALERT_TIERS[j].key, pct);
        sent[name + '|' + month + '|' + ALERT_TIERS[j].key] = true;
      }
    }
    posted++;
  }
  Logger.log((dryRun ? '[preview] ' : '') + 'Checked ' + checked + ' budgeted account(s); ' + posted + ' alert(s).');
  return { ok: true, checked: checked, alerts: posted };
}

function budgetAlertText(name, c, eff, pct, tier, toGo, dailyRows, remaining) {
  var mention = c.managerId ? ('<@' + c.managerId + '> ')
              : (c.managerName ? ('(cc ' + c.managerName + ') ') : '');
  var head = mention + tier.icon + ' *' + name + '* ' + tier.word + ' *' + Math.round(pct * 100) +
             '%* of budget with *' + toGo + ' day' + (toGo === 1 ? '' : 's') + '* to go';
  var line = 'Spent ' + moneyG(c.spend) + ' of ' + moneyG(eff);
  var proj = projectMonthEnd(dailyRows, remaining);
  if (proj != null) line += ' · trending to ' + moneyG(proj) + ' by month end';
  line += ' · <' + APP_URL + '|open pacing>';
  return head + '\n' + line;
}

/* ---- data assembly (mirrors what the app does) ---- */
function readGroupMeta() {
  var rows = readTab(GROUP_TAB), m = { group: {}, hidden: {}, manager: {}, anyLabels: false };
  for (var i = 0; i < rows.length; i++) {
    var id = String(rows[i].AccountId || '').trim(); if (!id) continue;
    var g = String(rows[i].Group || '').trim(); if (g) m.group[id] = g;
    if (String(rows[i].Hidden || '').trim() === '1') m.hidden[id] = true;
    var mg = String(rows[i].Manager || '').trim(); if (mg) m.manager[id] = mg;
  }
  return m;
}
function clientNameFor(row, meta) {
  var id = String(row.AccountId || '').trim();
  return meta.group[id] || String(row.Client || '').trim() || String(row.Account || '').trim();
}
function buildClientTotals(meta) {
  var feeds = readTab('Google_Feed').concat(readTab('Google_Feed_WL'))
              .concat(readTab('Microsoft_Feed')).concat(readTab('Microsoft_Feed_WL'));
  var out = {};
  for (var i = 0; i < feeds.length; i++) {
    var r = feeds[i], name = clientNameFor(r, meta); if (!name) continue;
    var id = String(r.AccountId || '').trim();
    var c = out[name] || (out[name] = { spend: 0, lastMonth: 0, active: false, hidden: false, managerName: '', managerId: '' });
    c.spend += numv(r.MTD_Spend);
    c.lastMonth += numv(r.LastMonth_Spend);
    if (meta.hidden[id]) c.hidden = true;
    var labels = String(r.Labels || '').split(',');
    for (var j = 0; j < labels.length; j++) {
      var L = labels[j].trim(); if (!L) continue;
      meta.anyLabels = true;
      if (L.toLowerCase() === ACTIVE_LABEL) c.active = true;   // exact match, so "Inactive" never counts
    }
    var mg = meta.manager[id];
    if (mg && !c.managerName) { var p = mg.split('|'); c.managerName = p[0]; c.managerId = p.length > 1 ? p[1] : ''; }
  }
  return out;
}
function readBudgetsFor(month) {
  var rows = readTab(BUDGET_TAB), out = {};
  for (var i = 0; i < rows.length; i++) {
    if (normMonth(rows[i].Month) !== month) continue;
    var name = String(rows[i].Client || '').trim(); if (!name) continue;
    out[name] = { mode: String(rows[i].Mode || 'manual').trim(), amount: numv(rows[i].Amount) };
  }
  return out;
}
function readDailyByClient(meta, month) {
  var rows = readTab('Daily_Google').concat(readTab('Daily_Google_WL'))
             .concat(readTab('Daily_Microsoft')).concat(readTab('Daily_Microsoft_WL'));
  var byClient = {};
  for (var i = 0; i < rows.length; i++) {
    var d = normDateG(rows[i].Date);
    if (!d || d.slice(0, 7) !== month) continue;
    var name = clientNameFor(rows[i], meta); if (!name) continue;
    var m = byClient[name] || (byClient[name] = {});
    m[d] = (m[d] || 0) + numv(rows[i].Spend);
  }
  var out = {};
  for (var k in byClient) {
    var dates = Object.keys(byClient[k]).sort(), arr = [];
    for (var j = 0; j < dates.length; j++) arr.push({ date: dates[j], spend: byClient[k][dates[j]] });
    out[k] = arr;
  }
  return out;
}
// spend so far (through yesterday) + recent daily rate × days remaining
function projectMonthEnd(rows, remaining) {
  if (!rows || !rows.length) return null;
  var today = todayIsoG(), hist = [];
  for (var i = 0; i < rows.length; i++) if (rows[i].date < today) hist.push(rows[i]);
  if (!hist.length) return null;
  var spent = 0;
  for (var j = 0; j < hist.length; j++) spent += hist[j].spend;
  var take = Math.min(RATE_DAYS_G, hist.length), rate = 0;
  for (var k = hist.length - take; k < hist.length; k++) rate += hist[k].spend;
  return spent + (rate / take) * remaining;
}

/* ---- "already told them" ledger ---- */
function readNotified() {
  var rows = readTab(NOTIFIED_TAB), out = {};
  for (var i = 0; i < rows.length; i++) {
    out[String(rows[i].Client || '').trim() + '|' + normMonth(rows[i].Month) + '|' + String(rows[i].Tier || '').trim()] = true;
  }
  return out;
}
function markNotified(client, month, tier, pct) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(NOTIFIED_TAB) || ss.insertSheet(NOTIFIED_TAB);
  ensureHeader(sheet, NOTIFIED_HEADER);
  sheet.appendRow([client, month, tier, Math.round(pct * 100) + '%', new Date().toISOString()]);
  var r = sheet.getLastRow();
  sheet.getRange(r, 2).setNumberFormat('@');
  sheet.getRange(r, 2).setValue(month);
}

/* ---- trigger management ---- */
function installBudgetAlertTrigger() {
  removeBudgetAlertTriggers();
  ScriptApp.newTrigger('runBudgetAlerts').timeBased().atHour(9).everyDays(1).create();
  Logger.log('Daily budget-alert trigger installed (runs ~9am).');
}
function removeBudgetAlertTriggers() {
  var ts = ScriptApp.getProjectTriggers();
  for (var i = 0; i < ts.length; i++) {
    if (ts[i].getHandlerFunction() === 'runBudgetAlerts') ScriptApp.deleteTrigger(ts[i]);
  }
}

/* ---- small helpers ---- */
function numv(v) { var n = Number(String(v == null ? '' : v).replace(/[$,\s]/g, '')); return isFinite(n) ? n : 0; }
function moneyG(n) {
  if (n == null || !isFinite(n)) return '$0';
  var s = String(Math.round(Math.abs(n))), out = '', c = 0;
  for (var i = s.length - 1; i >= 0; i--) { out = s.charAt(i) + out; if (++c % 3 === 0 && i > 0) out = ',' + out; }
  return (n < 0 ? '-$' : '$') + out;
}
function todayIsoG() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
function normDateG(v) {
  if (v == null) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return v.getFullYear() + '-' + ('0' + (v.getMonth() + 1)).slice(-2) + '-' + ('0' + v.getDate()).slice(-2);
  }
  var s = String(v).trim(), m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? (m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2)) : s;
}

/* ============================================================
   FACEBOOK
   ============================================================ */
// Serve Active-only Facebook rows (trimmed to a rolling window) + FB budgets.
function fbData(p) {
  requireSecret(p);
  var cache = CacheService.getScriptCache();
  var data = null;
  if (p.fresh !== '1') data = fbCacheGet_(cache, 'fbData');        // serve cache unless ?fresh=1
  if (!data) { data = readFbRows(); fbCachePut_(cache, 'fbData', data, FB_CACHE_SECS); }
  var budgets = readTab(FB_BUDGET_TAB).map(function (r) { r.Month = normMonth(r.Month); return r; }); // small tab, always fresh
  return { ok: true, rows: data.rows || [], accounts: data.accounts || [], budgets: budgets };
}
// Drop the cached FB read (rows depend on the active set, so any account
// activate/deactivate/rename must invalidate it).
function fbCacheClear_(cache) {
  try {
    var nStr = cache.get('fbData_n'); if (!nStr) return;
    var n = parseInt(nStr, 10), keys = ['fbData_n'];
    for (var i = 0; i < n; i++) keys.push('fbData_' + i);
    cache.removeAll(keys);
  } catch (e) {}
}

// Chunked Script-cache helpers (a cache value maxes at ~100KB, so split).
function fbCachePut_(cache, key, obj, ttl) {
  try {
    var s = JSON.stringify(obj), size = 95000, n = Math.ceil(s.length / size), map = {};
    if (n > 40) return;                                            // too big to cache; skip silently
    map[key + '_n'] = String(n);
    for (var i = 0; i < n; i++) map[key + '_' + i] = s.substring(i * size, (i + 1) * size);
    cache.putAll(map, ttl);
  } catch (e) {}
}
function fbCacheGet_(cache, key) {
  try {
    var nStr = cache.get(key + '_n'); if (!nStr) return null;
    var n = parseInt(nStr, 10), keys = [];
    for (var i = 0; i < n; i++) keys.push(key + '_' + i);
    var got = cache.getAll(keys), s = '';
    for (var j = 0; j < n; j++) { var part = got[key + '_' + j]; if (part == null) return null; s += part; }
    return JSON.parse(s);
  } catch (e) { return null; }
}

// Read the separate FB spreadsheet, keep only rows flagged Active in column M,
// and only the last FB_LOOKBACK_DAYS. Columns are matched by header name, so
// column order can change without breaking this. Only the last FB_MAX_ROWS rows
// are read (the export appends by date, so recent data is at the bottom) to
// bound the read time on very large sheets.
function readFbRows() {
  var ss = SpreadsheetApp.openById(FB_SPREADSHEET_ID);
  var sheet = ss.getSheetByName(FB_TAB);
  if (!sheet) throw new Error('Facebook tab not found: "' + FB_TAB + '"');
  var lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return { rows: [], accounts: [] };

  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0], idx = {};
  for (var j = 0; j < header.length; j++) idx[String(header[j]).trim()] = j;
  // Accepts several candidate header names (first match wins) so a column
  // rename in the sheet doesn't silently zero out a metric.
  function c() { for (var a = 0; a < arguments.length; a++) { if (idx[arguments[a]] != null) return idx[arguments[a]]; } return -1; }
  var iDate = c('Date'), iAcct = c('Account name'), iCamp = c('Campaign name'),
      iTags = c('Campaign tags'), iDB = c('Daily budget'), iStatus = c('Campaign status'),
      iCost = c('Total Cost'), iImp = c('Impressions'), iClk = c('Clicks'),
      // Conversions = website purchases; Revenue = their conversion value.
      // (Sheet headers were renamed from "Website conversions[ value]"; both accepted.)
      iWC = c('Website purchases', 'Website conversions'), iFL = c('On Facebook Leads'),
      iVal = c('Website purchases conversion value', 'Website conversions value'),
      iReg = c('Website registrations completed'),   // 2nd lead source; summed with On Facebook Leads
      iActive = c('Active'),
      // Optional budget-designation columns (add any of these to the sheet):
      iLife = c('Lifetime budget'), iBType = c('Budget type'), iBLevel = c('Budget level'),
      iBStart = c('Budget start'), iBEnd = c('Budget end');
  if (iDate   < 0) throw new Error('Facebook sheet is missing the "Date" column');
  if (iAcct   < 0) throw new Error('Facebook sheet is missing the "Account name" column');
  if (iCamp   < 0) throw new Error('Facebook sheet is missing the "Campaign name" column');
  // The "Active" column is now optional: which accounts are managed is controlled
  // in the tool (Facebook_Accounts tab). If the column is still present it acts as
  // the default for any account the tool hasn't set yet, for a smooth migration.

  var startRow = 2, numRows = lastRow - 1;
  if (numRows > FB_MAX_ROWS) { startRow = lastRow - FB_MAX_ROWS + 1; numRows = FB_MAX_ROWS; }
  var values = sheet.getRange(startRow, 1, numRows, lastCol).getValues();

  var cd = new Date(); cd.setDate(cd.getDate() - FB_LOOKBACK_DAYS);
  var cutoff = cd.getFullYear() + '-' + ('0' + (cd.getMonth() + 1)).slice(-2) + '-' + ('0' + cd.getDate()).slice(-2);

  var meta = readFbAccountsMeta_();                                 // tool-managed active/rename, keyed by account

  // Pass 1: every distinct account in the window, and whether the sheet marks it
  // Active anywhere (the migration default).
  var seen = {}, sheetActive = {};
  for (var i = 0; i < values.length; i++) {
    var acct = String(values[i][iAcct] || '').trim();
    if (!acct) continue;
    seen[acct] = true;
    if (iActive >= 0 && String(values[i][iActive]).trim() === 'Active') sheetActive[acct] = true;
  }
  function acctActive(acct) {                                       // tool store wins; else the sheet flag
    var m = meta[acct];
    if (m && m.active !== null) return m.active;
    return !!sheetActive[acct];
  }

  // Pass 2: rows for ACTIVE accounts only (unmanaged accounts never reach the browser).
  var out = [];
  for (var k = 0; k < values.length; k++) {
    var r = values[k], a = String(r[iAcct] || '').trim();
    if (!a || !acctActive(a)) continue;
    var d = normDateG(r[iDate]);
    if (!d || d < cutoff) continue;
    var o = {
      d: d, a: a,
      c: String(r[iCamp] || '').trim(),
      db: iDB < 0 ? 0 : numv(r[iDB]),
      st: iStatus < 0 ? '' : String(r[iStatus] || '').trim(),
      cost: numv(r[iCost]), imp: numv(r[iImp]), clk: numv(r[iClk]),
      wc: numv(r[iWC]), fl: numv(r[iFL]), val: numv(r[iVal]),
      rc: iReg < 0 ? 0 : numv(r[iReg])                 // website registrations completed
    };
    // Optional fields: only include when non-empty, to keep the payload small.
    var tg = iTags < 0 ? '' : String(r[iTags] || '').trim(); if (tg) o.tg = tg;
    if (iLife   >= 0) { var lv = numv(r[iLife]); if (lv) o.life = lv; }
    if (iBType  >= 0) { var bt = String(r[iBType]  || '').trim(); if (bt) o.bt = bt; }
    if (iBLevel >= 0) { var bl = String(r[iBLevel] || '').trim(); if (bl) o.bl = bl; }
    if (iBStart >= 0) { var bs = normDateG(r[iBStart]); if (bs) o.bs = bs; }
    if (iBEnd   >= 0) { var be = normDateG(r[iBEnd]);   if (be) o.be = be; }
    out.push(o);
  }

  // Full account roster (active + inactive) so the tool can list everything to
  // manage, while only active accounts ship their data above.
  var accounts = Object.keys(seen).map(function (acct) {
    var m = meta[acct] || {};
    return { account: acct, active: acctActive(acct), name: m.name || '' };
  }).sort(function (x, y) {
    var xn = (x.name || x.account).toLowerCase(), yn = (y.name || y.account).toLowerCase();
    return xn < yn ? -1 : (xn > yn ? 1 : 0);
  });

  return { rows: out, accounts: accounts };
}

// Upsert one campaign budget (Account + Campaign + Month) in the MAIN sheet.
function setFbBudget(p) {
  requireSecret(p);
  var account = String(p.account || '').trim();
  var campaign = String(p.campaign || '').trim();
  var month = normMonth(p.month);
  if (!account || !month) throw new Error('missing account/month');

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(FB_BUDGET_TAB) || ss.insertSheet(FB_BUDGET_TAB);
  ensureHeader(sheet, FB_BUDGET_HEADER);

  var values = sheet.getDataRange().getValues();
  var target = -1;
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === account && String(values[i][1]).trim() === campaign && normMonth(values[i][2]) === month) { target = i + 1; break; }
  }
  var mode = (p.mode === 'lastMonth' || p.mode === 'daily' || p.mode === 'auto' || p.mode === 'lifetime') ? p.mode : 'manual';
  var row = [account, campaign, month, mode, Number(p.amount) || 0, new Date().toISOString()];
  if (target === -1) { sheet.appendRow(row); target = sheet.getLastRow(); }
  else sheet.getRange(target, 1, 1, row.length).setValues([row]);
  sheet.getRange(target, 3).setNumberFormat('@');   // keep Month as text
  sheet.getRange(target, 3).setValue(month);
  logChange_(p.by, 'Social', 'Campaign budget', account + (campaign ? (' · ' + campaign) : ''), month + ' · ' + mode + (Number(p.amount) ? (' · $' + (Number(p.amount) || 0)) : ''));
  return { ok: true, row: target };
}

/* ---- Facebook account management: active flag + display rename (tool-only) ---- */
// { account: { active: true|false|null, name: '...' } }. active===null means the
// tool hasn't decided, so readFbRows falls back to the sheet's Active column.
function readFbAccountsMeta_() {
  var map = {};
  readTab(FB_ACCTS_TAB).forEach(function (r) {
    var acct = String(r.Account || '').trim(); if (!acct) return;
    var a = String(r.Active || '').trim().toLowerCase();
    var active = (a === 'yes' || a === 'y' || a === 'true' || a === '1') ? true
               : ((a === 'no' || a === 'n' || a === 'false' || a === '0') ? false : null);
    map[acct] = { active: active, name: String(r.Name || '').trim() };
  });
  return map;
}
// Upsert one account's row. Passing null for active or name leaves that field as-is.
function upsertFbAcct_(account, active, name) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(FB_ACCTS_TAB) || ss.insertSheet(FB_ACCTS_TAB);
  ensureHeader(sheet, FB_ACCTS_HEADER);
  var values = sheet.getDataRange().getValues(), target = -1;
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === account) { target = i + 1; break; }
  }
  var existing = target > 0 ? values[target - 1] : [account, '', '', ''];
  var act = (active == null) ? String(existing[1] || '') : (active ? 'yes' : 'no');
  var nm  = (name   == null) ? String(existing[2] || '') : name;
  var row = [account, act, nm, new Date().toISOString()];
  if (target === -1) { sheet.appendRow(row); } else { sheet.getRange(target, 1, 1, row.length).setValues([row]); }
}
function setFbActive(p) {
  requireSecret(p);
  var account = String(p.account || '').trim();
  if (!account) throw new Error('missing account');
  var active = (String(p.active) === '1' || String(p.active).toLowerCase() === 'true');
  upsertFbAcct_(account, active, null);
  fbCacheClear_(CacheService.getScriptCache());          // served rows depend on the active set
  logChange_(p.by, 'Social', 'Account ' + (active ? 'activated' : 'deactivated'), account, '');
  return { ok: true };
}
function setFbRename(p) {
  requireSecret(p);
  var account = String(p.account || '').trim();
  if (!account) throw new Error('missing account');
  var name = String(p.name || '').trim();
  upsertFbAcct_(account, null, name);
  fbCacheClear_(CacheService.getScriptCache());          // account roster (incl. display name) is cached with the rows
  logChange_(p.by, 'Social', 'Account rename', account, name ? ('→ ' + name) : '(cleared)');
  return { ok: true };
}

/* ---- reads ---- */
function readFeeds() {
  // Merge the MCC feed with an optional white-label feed written to *_WL tabs.
  // readTab returns [] for a missing tab, so this is a no-op until _WL exists.
  return {
    Google_Feed:    readTab('Google_Feed').concat(readTab('Google_Feed_WL')),
    Microsoft_Feed: readTab('Microsoft_Feed').concat(readTab('Microsoft_Feed_WL'))
  };
}
function readTab(name) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(name);
  if (!sheet) return [];
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var header = values[0], rows = [];
  for (var i = 1; i < values.length; i++) {
    var o = {};
    for (var j = 0; j < header.length; j++) o[header[j]] = values[i][j];
    rows.push(o);
  }
  return rows;
}

/* ---- helpers ---- */
function requireSecret(p) { if (p.secret !== SHARED_SECRET) throw new Error('bad secret'); }
function ensureHeader(sheet, header) {
  if (!header.length) return;
  if (sheet.getLastRow() === 0) { sheet.getRange(1, 1, 1, header.length).setValues([header]); return; }
  var cur = sheet.getRange(1, 1, 1, header.length).getValues()[0];
  var match = true;
  for (var i = 0; i < header.length; i++) { if (String(cur[i]).trim() !== header[i]) { match = false; break; } }
  if (!match) sheet.getRange(1, 1, 1, header.length).setValues([header]); // upgrade old/short headers (e.g. add the Type column)
}
function reply(obj, callback) {
  var text = JSON.stringify(obj);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + text + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT); // JSONP → works cross-origin
  }
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}
