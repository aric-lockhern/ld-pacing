/**
 * LOCKHERN — Account Pacing feed (GOOGLE ADS)
 * ------------------------------------------------------------------
 * Runs in a Google Ads MANAGER (MCC) account:
 *   Tools & settings → Bulk actions → Scripts → +  (New script)
 * Pulls month-to-date spend / conversions / conversion value plus last
 * month's total spend for every account under the MCC, and writes them
 * to a Google Sheet tab the pacing web app reads.
 *
 * SETUP
 *   1. Create a Google Sheet, copy its URL into SPREADSHEET_URL below.
 *   2. Paste this whole file into the script editor. Authorize.
 *   3. Click PREVIEW to test, check Logs, then RUN.
 *   4. Schedule it hourly (or a few times a day) — the app always shows
 *      the latest write.
 *
 * WHAT IT WRITES
 *   Google_Feed        Client | Account | AccountId | MTD_Spend | MTD_Conversions |
 *                      MTD_ConvValue | LastMonth_Spend | Currency | Labels | Updated
 *   Daily_Google       Client | Account | AccountId | Platform | Date | Spend |
 *                      Leads | Clicks | Impressions | Revenue
 *   Daily_Google_Conv  Client | Account | AccountId | Platform | Date | Action |
 *                      Conv | Value        ← per conversion ACTION (Purchases,
 *                      Add to cart, …) so the tool can let each client pick which
 *                      action(s) count as its reported Conversions. Additive; the
 *                      other two tabs are unchanged. Uses all_conversions so every
 *                      action shows up (incl. secondary ones not in "Conversions").
 * ------------------------------------------------------------------ */

var SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/d/19AOeg1RK0O09hJQpU1ItDRnYBEuNg2aGnyWzpgv_Sqk/';
var TAB_NAME = 'Google_Feed';

// ── White-label / second-account support ──────────────────────────────
// Leave these as-is for your normal MCC (writes straight to the sheet).
// For a SEPARATE account that isn't under your MCC and can't touch the
// sheet, run this same script there with:
//   USE_GATEWAY = true;  WEBAPP_URL + SHARED_SECRET set to your gateway;
//   TAB_SUFFIX  = '_WL';
// It then POSTs its accounts to Google_Feed_WL / Daily_Google_WL, which the
// gateway merges with your MCC feed. No sheet access needed, nothing shared.
var USE_GATEWAY   = false;
var WEBAPP_URL    = '';   // your gateway /exec URL (only needed if USE_GATEWAY)
var SHARED_SECRET = '';   // must match the gateway (only needed if USE_GATEWAY)
var TAB_SUFFIX    = '';   // '' for the MCC; '_WL' for the white-label account
// ──────────────────────────────────────────────────────────────────────

// How many days of daily history to pull for the account detail charts.
var LOOKBACK_DAYS = 120;

// Optional: limit to specific accounts. Empty = every account under the MCC.
// Example: ['123-456-7890', '234-567-8901']
var ACCOUNT_IDS = [];

// Optional: only needed for accounts that must be SUMMED with their Bing
// twin. Map the Google account name (or CID) to a shared Client name, and
// set the SAME Client name in the Microsoft script. Everything not listed
// here just uses its own account name.
var CLIENT_OVERRIDES = {
  // 'Xero Shoes - Google': 'Xero Shoes',
  // '123-456-7890': 'Xero Shoes',
};

function main() {
  var selector = AdsManagerApp.accounts();
  if (ACCOUNT_IDS.length) selector = selector.withIds(ACCOUNT_IDS);

  var accounts = selector.get();
  var rows = [];
  var dailyRows = [];
  var convRows = [];   // per conversion-action daily rows (Daily_Google_Conv)

  while (accounts.hasNext()) {
    var account = accounts.next();
    AdsManagerApp.select(account); // subsequent AdsApp calls run in this account

    var name = account.getName();
    var cid = account.getCustomerId();

    var mtd = getStats('THIS_MONTH');
    var lastMonth = getStats('LAST_MONTH');

    var client = CLIENT_OVERRIDES[cid] || CLIENT_OVERRIDES[name] || name;
    var labels = getAccountLabels(account); // e.g. "Active|Ecommerce"

    rows.push([
      client, name, cid,
      round2(mtd.cost), round2(mtd.conv), round2(mtd.val),
      round2(lastMonth.cost), mtd.currency, labels, new Date()
    ]);
    collectDaily(client, name, cid, dailyRows);
    collectConvActions(client, name, cid, convRows);
  }

  writeFeed(rows);
  writeDaily(dailyRows);
  writeConvDaily(convRows);
  Logger.log('Google feed: wrote ' + rows.length + ' account(s), ' + dailyRows.length +
             ' daily rows, ' + convRows.length + ' conversion-action rows.');
}

/**
 * Day-by-day metrics for THIS_MONTH, one row per day, for the account detail view.
 * Selecting segments.date returns one row per day.
 */
function collectDaily(client, name, cid, out) {
  var tz = AdsApp.currentAccount().getTimeZone();
  var end = new Date(), start = new Date(); start.setDate(start.getDate() - (LOOKBACK_DAYS - 1));
  var s = Utilities.formatDate(start, tz, 'yyyy-MM-dd'), e = Utilities.formatDate(end, tz, 'yyyy-MM-dd');
  var q = 'SELECT segments.date, metrics.cost_micros, metrics.conversions, metrics.conversions_value, ' +
          "metrics.clicks, metrics.impressions FROM customer WHERE segments.date BETWEEN '" + s + "' AND '" + e + "' ORDER BY segments.date";
  var report = AdsApp.report(q).rows();
  while (report.hasNext()) {
    var r = report.next();
    out.push([
      client, name, cid, 'Google', r['segments.date'],
      round2(Number(r['metrics.cost_micros']) / 1000000), round2(Number(r['metrics.conversions'])),
      Number(r['metrics.clicks']), Number(r['metrics.impressions']), round2(Number(r['metrics.conversions_value']))
    ]);
  }
}

/**
 * Per conversion-ACTION daily metrics (Purchases, Add to cart, Begin checkout, …),
 * one row per (day, action) at the account level. Uses metrics.all_conversions so
 * EVERY action is broken out — including secondary actions that aren't counted in
 * the account's headline "Conversions" column — which is what lets each client pick
 * the action(s) that matter for its reporting. Additive: does not affect the
 * Google_Feed / Daily_Google numbers.
 */
function collectConvActions(client, name, cid, out) {
  var tz = AdsApp.currentAccount().getTimeZone();
  var end = new Date(), start = new Date(); start.setDate(start.getDate() - (LOOKBACK_DAYS - 1));
  var s = Utilities.formatDate(start, tz, 'yyyy-MM-dd'), e = Utilities.formatDate(end, tz, 'yyyy-MM-dd');
  var q = 'SELECT segments.date, segments.conversion_action_name, ' +
          'metrics.all_conversions, metrics.all_conversions_value ' +
          "FROM customer WHERE segments.date BETWEEN '" + s + "' AND '" + e + "' ORDER BY segments.date";
  var report;
  try { report = AdsApp.report(q).rows(); }
  catch (err) { Logger.log('Conversion-action query failed for "' + name + '": ' + err); return; }
  while (report.hasNext()) {
    var r = report.next();
    var conv = Number(r['metrics.all_conversions']) || 0;
    var val  = Number(r['metrics.all_conversions_value']) || 0;
    if (!conv && !val) continue;
    out.push([
      client, name, cid, 'Google', r['segments.date'],
      String(r['segments.conversion_action_name'] || '(unnamed)'),
      round2(conv), round2(val)
    ]);
  }
}

function writeDaily(rows) {
  var header = ['Client', 'Account', 'AccountId', 'Platform', 'Date', 'Spend', 'Leads', 'Clicks', 'Impressions', 'Revenue'];
  pushTab('Daily_Google', header, rows, 5); // Date is column 5, keep as text
}

function writeConvDaily(rows) {
  var header = ['Client', 'Account', 'AccountId', 'Platform', 'Date', 'Action', 'Conv', 'Value'];
  pushTab('Daily_Google_Conv', header, rows, 5); // Date is column 5, keep as text
}

/**
 * Aggregated account-level metrics for a date range (THIS_MONTH / LAST_MONTH).
 * Querying FROM customer without selecting segments.date returns a single row
 * whose metrics are summed across the whole range.
 */
function getStats(dateRange) {
  var query =
    'SELECT metrics.cost_micros, metrics.conversions, metrics.conversions_value, ' +
    'customer.currency_code FROM customer WHERE segments.date DURING ' + dateRange;

  var out = { cost: 0, conv: 0, val: 0, currency: '' };
  var report = AdsApp.report(query).rows();
  if (report.hasNext()) {
    var r = report.next();
    out.cost = Number(r['metrics.cost_micros']) / 1000000; // micros → currency
    out.conv = Number(r['metrics.conversions']);
    out.val = Number(r['metrics.conversions_value']);
    out.currency = r['customer.currency_code'];
  }
  return out;
}

/**
 * Account-level labels applied to this managed account, joined with "|".
 * The web app filters on these (only shows accounts labelled "Active").
 */
function getAccountLabels(account) {
  var names = [];
  try {
    var it = account.labels().get();
    while (it.hasNext()) names.push(it.next().getName());
  } catch (e) {
    Logger.log('Could not read labels for "' + account.getName() + '": ' + e);
  }
  return names.join('|');
}

function writeFeed(rows) {
  var header = ['Client', 'Account', 'AccountId', 'MTD_Spend', 'MTD_Conversions',
                'MTD_ConvValue', 'LastMonth_Spend', 'Currency', 'Labels', 'Updated'];
  pushTab(TAB_NAME, header, rows);
}

/**
 * Writes a tab. For the MCC this writes straight to the sheet (unchanged
 * behavior). For a white-label account (USE_GATEWAY) it POSTs the rows to the
 * gateway instead — no sheet access needed — into the TAB_SUFFIX'd tab.
 */
function pushTab(tab, header, rows, textCol) {
  var name = tab + TAB_SUFFIX;
  if (USE_GATEWAY) {
    var res = UrlFetchApp.fetch(WEBAPP_URL, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ secret: SHARED_SECRET, mode: 'replace', tab: name, header: header, rows: rows }),
      followRedirects: true, muteHttpExceptions: true
    });
    Logger.log('Gateway write [' + name + ']: ' + res.getResponseCode() + ' ' + res.getContentText());
    return;
  }
  var ss = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, header.length).setValues([header]);
  if (rows.length) {
    if (textCol) sheet.getRange(2, textCol, rows.length, 1).setNumberFormat('@');
    sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
  }
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

/* ------------------------------------------------------------------
 * SCALE NOTE: this processes accounts sequentially. For very large MCCs
 * (roughly 50+ accounts) or if the run times out, switch to
 * AdsManagerApp.accounts().executeInParallel('processAccount','finish').
 * Ping me and I'll convert it — the per-account logic is already isolated
 * in getStats().
 * ------------------------------------------------------------------ */
