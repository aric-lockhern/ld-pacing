/**
 * Google Ads MCC — Conversion-Actions Feed  (additive; for Lockhern Account Pacing)
 * =============================================================================
 * Writes ONE new tab to the pacing spreadsheet:
 *
 *     Daily_Google_Conv :  Date | AccountId | Account | Action | Conv | Value
 *
 * ...one row per (day, account, conversion action). This lets the pacing tool
 * list EVERY conversion action an account records and let you pick, PER CLIENT,
 * which action(s) count as that client's reported Conversions / CPA / ROAS —
 * e.g. report on Purchases only, even while the account also optimizes toward
 * Add to cart.
 *
 * WHY all_conversions: it segments cleanly by conversion action and includes
 * EVERY action — even secondary ones not counted in the account's "Conversions"
 * column — which is exactly what makes the per-client picker useful. (The plain
 * "Conversions" metric only breaks out primary actions.)
 *
 * ADDITIVE + SAFE: this does NOT touch the Google_Feed / Daily_Google tabs your
 * existing pacing feed writes. Run it on its own schedule alongside that feed.
 * Until someone actually picks actions in the tool, nothing about the numbers
 * changes — the tool falls back to the totals it already shows.
 *
 * SETUP (once)
 *   1. Google Ads (MCC) → Tools → Bulk actions → Scripts → (+) → paste this file.
 *   2. Set ACCOUNT_LABEL below to the SAME label your existing Google pacing feed
 *      uses to select accounts (case-sensitive in the MCC filter).
 *   3. Authorize → Preview → then schedule it (hourly or daily is fine).
 *
 * The SPREADSHEET_URL is already the pacing sheet. If you ever move sheets,
 * update it here and in the gateway (Code.gs FB/main SPREADSHEET_ID).
 *
 * Lockhern Digital — internal.
 * --------------------------------------------------------------------------- */
var SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/d/19AOeg1RK0O09hJQpU1ItDRnYBEuNg2aGnyWzpgv_Sqk/edit';
var ACCOUNT_LABEL   = 'Active';   // MUST match the label your existing Google feed selects on
var LOOKBACK_DAYS   = 95;         // rolling window rewritten each run
var TAB             = 'Daily_Google_Conv';
var HEADER          = ['Date', 'AccountId', 'Account', 'Action', 'Conv', 'Value'];
var MAX_ROWS        = 200000;     // safety cap on the tab
/* --------------------------------------------------------------------------- */

function main() {
  var ss = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
  var range = dateRange_(LOOKBACK_DAYS);
  var out = [];   // [Date, AccountId, Account, Action, Conv, Value]

  var selector = AdsManagerApp.accounts();
  if (ACCOUNT_LABEL) selector = selector.withCondition("LabelNames CONTAINS '" + ACCOUNT_LABEL + "'");
  var accounts = selector.get();

  var q =
    "SELECT segments.date, segments.conversion_action_name, " +
    "metrics.all_conversions, metrics.all_conversions_value " +
    "FROM campaign " +
    "WHERE segments.date BETWEEN '" + range.startDash + "' AND '" + range.endDash + "' " +
    "AND campaign.status != 'REMOVED'";

  var acctCount = 0;
  while (accounts.hasNext()) {
    var acct = accounts.next();
    AdsManagerApp.select(acct);
    acctCount++;
    var acctId = acct.getCustomerId();
    var acctName = acct.getName() || acctId;

    // Sum across campaigns → one figure per (date, action) for the account.
    var agg = {};   // "date \x01 action" -> {date, action, conv, val}
    var it;
    try { it = AdsApp.search(q); }
    catch (e) { Logger.log('[' + acctName + '] conversion query failed: ' + e); continue; }
    while (it.hasNext()) {
      var r = it.next();
      var date = String(r.segments.date);                              // yyyy-mm-dd
      var action = String(r.segments.conversionActionName || '(unnamed)');
      var conv = Number(r.metrics.allConversions || 0);
      var val  = Number(r.metrics.allConversionsValue || 0);
      if (!conv && !val) continue;
      var k = date + '' + action;
      var a = agg[k] || (agg[k] = { date: date, action: action, conv: 0, val: 0 });
      a.conv += conv; a.val += val;
    }
    Object.keys(agg).forEach(function (k) {
      var a = agg[k];
      out.push([a.date, acctId, acctName, a.action, r2(a.conv), r2(a.val)]);
    });
  }

  // newest rows win if we ever exceed the cap
  if (out.length > MAX_ROWS) out = out.slice(out.length - MAX_ROWS);

  var sheet = ss.getSheetByName(TAB) || ss.insertSheet(TAB);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
  if (out.length) sheet.getRange(2, 1, out.length, HEADER.length).setValues(out);
  Logger.log('Conversion-actions feed: ' + out.length + ' rows from ' + acctCount + ' account(s) → ' + TAB);
}

function dateRange_(days) {
  var tz = AdsApp.currentAccount().getTimeZone();
  var end = new Date();
  var start = new Date(); start.setDate(start.getDate() - days);
  return {
    startDash: Utilities.formatDate(start, tz, 'yyyy-MM-dd'),
    endDash:   Utilities.formatDate(end,   tz, 'yyyy-MM-dd')
  };
}
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
