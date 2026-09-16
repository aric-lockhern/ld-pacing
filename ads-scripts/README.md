# Ads scripts (upstream feeds)

These run **inside Google Ads / Microsoft Advertising**, not on Netlify or in the
gateway. They write data into the pacing Google Sheet that the gateway reads.
They are version-controlled here for review; you still paste them into the ads
platform and schedule them there (they can't be auto-deployed — they don't run
on our servers).

| File | Runs in | Writes | Purpose |
|---|---|---|---|
| `google_conv_actions_feed.js` | Google Ads (MCC) | `Daily_Google_Conv` tab | Per-conversion-action daily figures so each client can pick which action(s) count as its reported Conversions (Purchases vs Add to cart, etc.). **Additive** — doesn't touch the existing `Google_Feed` / `Daily_Google` tabs. |

## Installing `google_conv_actions_feed.js`

1. Google Ads (MCC) → **Tools → Bulk actions → Scripts → (+)** → paste the file.
2. Set **`ACCOUNT_LABEL`** at the top to the **same label your existing Google
   pacing feed** uses to select accounts.
3. **Authorize → Preview**, confirm it logs a row count, then **schedule** it
   (hourly or daily). It writes the `Daily_Google_Conv` tab:
   `Date | AccountId | Account | Action | Conv | Value`.

It's safe to run alongside the existing feed. Until someone picks specific
actions for a client in the tool, nothing about the displayed numbers changes —
the tool keeps showing the account's total conversions.

> Microsoft/Bing: a matching `microsoft_conv_actions_feed.js` writing
> `Daily_Microsoft_Conv` can be added the same way once the Google side is
> confirmed working.
