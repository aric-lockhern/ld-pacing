/**
 * LOCKHERN — Account Pacing feed (MICROSOFT ADVERTISING)
 * ------------------------------------------------------------------
 * Microsoft's Scripts sandbox has NO SpreadsheetApp and NO AdsApp.report,
 * so this script can't touch a Google Sheet directly. Instead it POSTs its
 * rows to the Apps Script web app (the gateway / sheet receiver), which
 * writes them to the sheet.
 *
 * BEFORE RUNNING:
 *   1. Deploy the gateway as a web app (see apps-script/Code.gs).
 *   2. Paste its /exec URL into WEBAPP_URL below.
 *   3. Make SHARED_SECRET match the gateway.
 *
 * WHERE TO RUN:
 *   • Manager account (recommended): top menu → pick the manager account →
 *     Bulk Operations → Scripts. Pulls every account, full refresh.
 *   • Single account (Tools → Scripts): updates just that account's row.
 *
 * Run in PREVIEW first and check Logs — the last line prints the sheet
 * write response (expect {"ok":true,...}).
 *
 * REVENUE: Microsoft's Stats object exposes getRevenue() (advertiser-reported
 * revenue) — the equivalent of Google's conversion value — so MTD_ConvValue is
 * populated and Bing ROAS works. Lead-gen accounts with no revenue report 0.
 *
 * CONVERSION-ACTION NOTE: Microsoft's Scripts Stats object reports only TOTAL
 * conversions/revenue — there is no per-conversion-goal breakdown available here
 * (unlike Google's all_conversions by conversion action). So this feed does NOT
 * write a Daily_Microsoft_Conv tab. The pacing tool therefore counts a client's
 * Bing conversions as a whole; per-action reporting is Google-only for now. If a
 * Bing account needs purchases separated from other goals, set up the account so
 * only Purchases is a tracked conversion (then its total already equals
 * purchases), or we move Bing to the Microsoft Reporting API (separate work).
 * ------------------------------------------------------------------ */

var WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbw3NZFjb0A3jN1OS3Kwu_1obkyy-8KU6lCAUXjawqFG66guzY3GU0hbC5A6RH3oQNLD/exec'; // ends in /exec
var SHARED_SECRET = 'lockhern-pacing'; // must match the receiver
var TAB_NAME = 'Microsoft_Feed';

// '' for your normal account; set to '_WL' for a separate white-label account
// so it writes Microsoft_Feed_WL / Daily_Microsoft_WL (merged by the gateway).
var TAB_SUFFIX = '';

var ACCOUNT_IDS = []; // manager mode only. empty = every account under the manager

// For accounts that must SUM with their Google twin, set the SAME Client
// name here as in the Google script.
var CLIENT_OVERRIDES = {
  // 'Xero Shoes (Bing)': 'Xero Shoes',
};

var HEADER = ['Client', 'Account', 'AccountId', 'MTD_Spend', 'MTD_Conversions',
              'MTD_ConvValue', 'LastMonth_Spend', 'Currency', 'Labels', 'Updated'];
var DAILY_HEADER = ['Client', 'Account', 'AccountId', 'Platform', 'Date', 'Spend', 'Leads', 'Clicks', 'Impressions', 'Revenue'];

// Daily pull powers the account detail charts. It loops day-by-day, so it's
// heavier than the monthly pull — set false if the run gets close to timing out.
var DAILY_ENABLED = true;
var LOOKBACK_DAYS = 120; // days of daily history for the detail charts

// How daily stats are gathered:
//   'account'  = one pull per day across all accounts (fast; the default)
//   'campaign' = per account, sum campaigns per day (slower, but a safe fallback
//                if account-level daily stats error in preview)
var DAILY_MODE = 'account';

function main() {
  if (typeof AccountsApp !== 'undefined') runManager();
  else runSingleAccount();
}

/* -------- manager editor: all accounts, full refresh -------- */
function runManager() {
  var byId = {};

  forEachAccount('THIS_MONTH', function (account) {
    var cid = String(account.getAccountId());
    var cc = costConv(account, 'THIS_MONTH');
    byId[cid] = { name: account.getName(), cid: cid, cost: cc.cost, conv: cc.conv, val: cc.val, last: 0 };
  });

  forEachAccount('LAST_MONTH', function (account) {
    var cid = String(account.getAccountId());
    if (!byId[cid]) byId[cid] = { name: account.getName(), cid: cid, cost: 0, conv: 0, last: 0 };
    byId[cid].last = costConv(account, 'LAST_MONTH').cost;
  });

  var rows = [];
  for (var k in byId) rows.push(toRow(byId[k]));
  postToSheet('replace', rows);
  Logger.log('Microsoft (manager): prepared ' + rows.length + ' account(s).');

  if (DAILY_ENABLED) buildDailyManager();
}

/* -------- daily rows (day-by-day, for the account detail charts) -------- */
function buildDailyManager() {
  var days = lookbackDays(LOOKBACK_DAYS);
  var rows = [];

  if (DAILY_MODE === 'campaign') {
    // per account (select), sum campaigns for each day
    var accts = AccountsApp.accounts();
    if (ACCOUNT_IDS.length) accts = accts.withIds(ACCOUNT_IDS);
    var ait = accts.get();
    while (ait.hasNext()) {
      var account = ait.next();
      AccountsApp.select(account);
      var cid = String(account.getAccountId()), name = account.getName();
      var client = CLIENT_OVERRIDES[cid] || CLIENT_OVERRIDES[name] || name;
      for (var d = 0; d < days.length; d++) {
        var a = campaignDay(days[d].str);
        rows.push([client, name, cid, 'Microsoft', days[d].iso,
                   round2(a.cost), round2(a.conv), a.clicks, a.impr, round2(a.rev)]);
      }
    }
  } else {
    // one selector per day returns every account's stats for that day (fast)
    for (var i = 0; i < days.length; i++) {
      var sel = AccountsApp.accounts().forDateRange(days[i].str, days[i].str);
      if (ACCOUNT_IDS.length) sel = sel.withIds(ACCOUNT_IDS);
      var it = sel.get();
      while (it.hasNext()) {
        var acc = it.next();
        var s; try { s = acc.getStats(); } catch (e) { continue; }
        var c2 = String(acc.getAccountId()), n2 = acc.getName();
        var cl = CLIENT_OVERRIDES[c2] || CLIENT_OVERRIDES[n2] || n2;
        rows.push([cl, n2, c2, 'Microsoft', days[i].iso,
                   round2(num(s.getCost())), round2(num(s.getConversions())),
                   num(s.getClicks()), num(s.getImpressions()), round2(num(s.getRevenue()))]);
      }
    }
  }

  postToSheet('replace', rows, 'Daily_Microsoft', DAILY_HEADER);
  Logger.log('Microsoft daily [' + DAILY_MODE + ']: prepared ' + rows.length + ' day-rows across ' + days.length + ' day(s).');
}

// One day's account totals, summed from campaigns (campaign mode).
function campaignDay(dayStr) {
  var o = { cost: 0, conv: 0, clicks: 0, impr: 0, rev: 0 };
  var it = AdsApp.campaigns().forDateRange(dayStr, dayStr).get();
  while (it.hasNext()) {
    var s = it.next().getStats();
    o.cost += num(s.getCost()); o.conv += num(s.getConversions());
    o.clicks += num(s.getClicks()); o.impr += num(s.getImpressions()); o.rev += num(s.getRevenue());
  }
  return o;
}

// The last N days (including today) as {str:'YYYYMMDD', iso:'YYYY-MM-DD'}.
function lookbackDays(n) {
  var out = [], now = new Date();
  for (var i = n - 1; i >= 0; i--) {
    var d = new Date(now); d.setDate(now.getDate() - i);
    var mm = ('0' + (d.getMonth() + 1)).slice(-2), dd = ('0' + d.getDate()).slice(-2);
    out.push({ str: '' + d.getFullYear() + mm + dd, iso: d.getFullYear() + '-' + mm + '-' + dd });
  }
  return out;
}

/* -------- single-account editor: just this account, upsert -------- */
function runSingleAccount() {
  var account = AdsApp.currentAccount();
  var mtd = campaignSum('THIS_MONTH');
  var last = campaignSum('LAST_MONTH');
  var entry = { name: account.getName(), cid: String(account.getAccountId()),
                cost: mtd.cost, conv: mtd.conv, val: mtd.val, last: last.cost };
  postToSheet('upsert', [toRow(entry)]);
  Logger.log('Microsoft (single account): prepared "' + entry.name + '".');
}

/* -------- stats (no report, no SpreadsheetApp) -------- */
function forEachAccount(range, cb) {
  var selector = AccountsApp.accounts().forDateRange(range);
  if (ACCOUNT_IDS.length) selector = selector.withIds(ACCOUNT_IDS);
  var it = selector.get();
  while (it.hasNext()) cb(it.next());
}

// Primary: account-level stats (the account came from a forDateRange selector).
// Fallback: sum campaign stats.
function costConv(account, range) {
  try {
    var s = account.getStats();
    return { cost: num(s.getCost()), conv: num(s.getConversions()), val: num(s.getRevenue()) };
  } catch (e) {
    try {
      AccountsApp.select(account);
      return campaignSum(range);
    } catch (e2) {
      Logger.log('Stats unavailable for "' + account.getName() + '": ' + e2);
      return { cost: 0, conv: 0, val: 0 };
    }
  }
}

function campaignSum(range) {
  var it = AdsApp.campaigns().forDateRange(range).get();
  var cost = 0, conv = 0, val = 0;
  while (it.hasNext()) {
    var s = it.next().getStats();
    cost += num(s.getCost());
    conv += num(s.getConversions());
    val += num(s.getRevenue());
  }
  return { cost: cost, conv: conv, val: val };
}

/* -------- send rows to the Apps Script receiver -------- */
function postToSheet(mode, rows, tab, header) {
  tab = (tab || TAB_NAME) + TAB_SUFFIX; header = header || HEADER;
  if (WEBAPP_URL.indexOf('http') !== 0) {
    Logger.log('Set WEBAPP_URL first (deploy the gateway). Rows prepared for "' + tab + '": ' + rows.length);
    return;
  }
  var payload = { secret: SHARED_SECRET, mode: mode, tab: tab, header: header, rows: rows };
  var res = UrlFetchApp.fetch(WEBAPP_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    followRedirects: true,
    muteHttpExceptions: true
  });
  Logger.log('Sheet write ["' + tab + '"] response: ' + res.getResponseCode() + ' ' + res.getContentText());
}

/* -------- helpers -------- */
function num(n) { return Number(n) || 0; }
function round2(n) { return Math.round(num(n) * 100) / 100; }
function toRow(e) {
  var client = CLIENT_OVERRIDES[e.cid] || CLIENT_OVERRIDES[e.name] || e.name;
  return [client, e.name, e.cid,
          round2(e.cost), round2(e.conv), round2(e.val) /* Revenue = conv. value */,
          round2(e.last), '', '' /* Currency, Labels (blank on Bing) */,
          new Date().toISOString()];
}
