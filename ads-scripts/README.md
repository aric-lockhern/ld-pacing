# Ads scripts (upstream feeds)

These run **inside Google Ads / Microsoft Advertising**, not on Netlify or in the
gateway. They write data into the pacing Google Sheet that the gateway reads.
They're version-controlled here for review; you still paste them into the ads
platform and schedule them there (they can't be auto-deployed — they don't run
on our servers).

| File | Runs in | Writes |
|---|---|---|
| `google_feed.js` | Google Ads (MCC) | `Google_Feed`, `Daily_Google`, **`Daily_Google_Conv`** |

> Microsoft/Bing has a matching feed script (writes `Microsoft_Feed` /
> `Daily_Microsoft`). It isn't in the repo yet — paste it in and we'll version it
> and add the same per-conversion-action tab (`Daily_Microsoft_Conv`).

## `google_feed.js`

This is the live Google feed, now with **per-conversion-action** output added.
Three tabs:

- `Google_Feed` — account MTD spend / conversions / value (+ last-month spend). *unchanged*
- `Daily_Google` — per-day spend / leads / clicks / impressions / revenue. *unchanged*
- **`Daily_Google_Conv`** — `Client | Account | AccountId | Platform | Date | Action | Conv | Value`,
  one row per day per conversion **action**. Uses `all_conversions`, so every
  action shows up (including secondary ones like *Add to cart* that aren't in the
  account's headline "Conversions"). This is what powers the per-client
  conversion picker in the tool.

**Additive & safe:** the two existing tabs are untouched. Until someone picks
specific actions for a client in the tool, the displayed numbers don't change.

### Install / update
1. Google Ads (MCC) → **Tools → Bulk actions → Scripts** → open your existing
   Google pacing script (or a new one) → **replace its contents** with
   `google_feed.js` (it's a strict superset of the old feed — same account
   selection, same `CLIENT_OVERRIDES`, plus the new tab).
2. **Authorize → Preview** (Logs show the row counts), then keep it on its
   existing schedule.

Nothing else needs the Bing script to be running — Google works on its own.
