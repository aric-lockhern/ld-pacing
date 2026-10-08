# Lockhern — Account Pacing

Internal dashboard for pacing Google + Microsoft ad accounts against monthly
budgets. Live at **https://pacing.lockherndigital.com**.

## What's in here

| Path | What it is | Where it runs |
| --- | --- | --- |
| `index.html` | The entire front-end (one self-contained file — HTML, CSS, JS). | **Netlify** (this repo). |
| `apps-script/Code.gs` | The "gateway" — reads/writes the private Google Sheet, posts Slack alerts. | **Google Apps Script** (deployed separately as a web app). Kept here for version control only; secrets are redacted. |
| `netlify.toml` | Netlify build/publish config. | Netlify. |

**Budget discipline (Search):** each client can be marked **Strict** (hold to
budget) or **Fluid** (over/under is ok) in the expanded row. Fluid clients don't
raise budget/burn *Issues* (their pace still shows). Stored in a `Discipline`
column the gateway adds to the `Groups` tab automatically.

**Change log:** every change made through the tool (budgets, budget mode, type,
manager, group/rename, hide, dismiss, discipline) is appended to a `Changelog`
tab (When · By · Area · Action · Target · Detail) and shown under **Settings →
Change log**. "By" is the name set for Slack notes. Both are auto-created; no
manual sheet setup needed, but the gateway must be redeployed.

The front-end talks to the Apps Script gateway over JSONP, so the Google Sheet
stays private. Netlify only ever serves `index.html`.

## Deploying

### Front-end (Netlify ← GitHub)

Netlify auto-deploys from the `main` branch of this repo. **Push to `main` →
Netlify rebuilds and publishes.** There is no build step; `netlify.toml` just
publishes the repo root.

**One-time connect (migrating an existing Netlify site to this repo):**

1. Netlify → your existing pacing site → **Site configuration → Build & deploy
   → Continuous deployment**.
2. **Link repository** (or "Manage repository") → **GitHub** → authorize →
   pick `aric-lockhern/ld-pacing`.
3. Settings when prompted:
   - **Production branch:** `main`
   - **Build command:** *(leave blank)*
   - **Publish directory:** `.` *(repo root — it's read from `netlify.toml` too)*
4. **Deploy site.** The custom domain `pacing.lockherndigital.com` stays on the
   same site, so no DNS changes are needed.

After this, drag-and-drop uploads are no longer needed — every change is a git
push.

### Backend (Google Apps Script — NOT Netlify)

`apps-script/Code.gs` is the source of record only. To change the live gateway:
edit the project at script.google.com, then **Deploy → Manage deployments →
New version** (the `/exec` URL keeps serving the old code until you do).

The real `SLACK_WEBHOOK_URL` and `SLACK_BOT_TOKEN` live in the Apps Script
project's **Script properties** (Project Settings → Script properties), not in
this file — so they survive every redeploy and never end up in the repo (GitHub
secret scanning blocks committing them, and this feeds a public site). Add the
two properties once, or paste them into `saveSlackSecrets()` and Run it once.
The constants in `Code.gs` are inert `REDACTED_…` fallbacks.

## Facebook tab

`facebook.js` adds a **Facebook** tab that reuses the same pacing engine. It's
fed from a **separate** Google Sheet (`FB - Daily`, campaign-level by date),
read through the gateway's `fbData` action.

- **Which accounts are managed is controlled in the tool** — **⚙ Manage
  accounts** lists every account in the sheet with an active/inactive toggle;
  only **active** accounts pull data and pace, so unmanaged accounts never reach
  the browser. Active flags + tool-only **display renames** are stored team-wide
  in a `Facebook_Accounts` tab in the main sheet (`Account · Active · Name`), and
  the account name in the `FB - Daily` sheet stays the join key (renames don't
  touch it). The sheet's old `Active` column is now optional — it's used only as
  the default for an account the tool hasn't toggled yet (smooth migration). The
  gateway trims to the last 95 days.
- **Leads** = `On Facebook Leads` + `Website registrations completed` (summed) by
  default, with a **CPL** column; purchase accounts still show
  Conversions/Revenue/ROAS. **Which column(s) count as Leads is configurable per
  client** — in **⚙ Manage accounts**, each account has a **Leads count** row of
  chips (FB Leads · Registrations · Web Contacts · Purchases); pick one or more.
  A client like **Cedar Group** that tracks leads in a different column can switch
  to **Web Contacts** (the `Website Contacts` column) instead. The selection is
  stored team-wide in the `Facebook_Accounts` tab (a `Leads` column, comma-
  separated keys; empty = the default). The optional `Website Contacts` column on
  the `FB - Daily` sheet feeds this (the tool reads 0 if it's absent).
- Two levels: an **account rollup** row, expandable to **per-campaign pacing**
  (each campaign has its own monthly budget).
- Campaign budgets are stored in a `Facebook_Budgets` tab in the main sheet
  (`Account · Campaign · Month · Mode · Amount`), separate from Google/Microsoft.
  Per-campaign budget **mode** (chosen in the expanded row):
  - **Automatic** (default) — uses whatever the sheet reports for the campaign:
    a **daily** budget → `spent so far + daily × days left`; a **lifetime**
    budget → prorated to the month by flight dates (or the full amount if no
    dates). This is the "just track what Meta has" mode.
  - **Daily** — type a daily budget in the tool → `spent + daily × days left`.
  - **Monthly** — a flat monthly amount.
  - **Lifetime** — a lifetime amount, prorated to the month.
  - A badge on each campaign shows whether Meta holds the budget at
    **campaign (CBO)** or **ad-set (ABO)** level, and flags **lifetime**.

  Optional columns on the `FB - Daily` sheet drive Automatic mode + the badge
  (all optional; the tool infers/falls back if absent):
  `Lifetime budget`, `Budget type` (daily|lifetime), `Budget level`
  (campaign|ad set), and `Budget start` + `Budget end` (for lifetime proration).

To point at a different FB spreadsheet/tab, edit `FB_SPREADSHEET_ID` / `FB_TAB`
in `Code.gs`. The gateway's Google account must have access to that spreadsheet,
and **you must redeploy the gateway as a new version** after editing `Code.gs`.

## Config

`DEFAULT_WEBAPP_URL` and `DEFAULT_SECRET` at the top of `index.html` point the
front-end at the gateway for the whole team. The in-app **Settings** tab can
override them per-browser, but the committed defaults are what everyone gets.

## Fast read path (fast loading)

Google's Apps Script **web-app front end** is the slow, flaky part — the script
runs in milliseconds, but requests take 3–50 s and sometimes come back 404 from
`script.googleusercontent.com`. So **reads no longer depend on it.** The Sheet and
Apps Script stay the source of truth and the only writer; the page just reads from
a copy served on its own domain.

```
Apps Script (Publish.gs)  ──gzipped POST──▶  <site>/api/ingest  ──▶  Netlify Blobs
  every 5 min + after each write                (netlify/functions/api.mjs)
                                                        ▲
  index.html  ──GET <site>/api?action=…──────────────── ┘   (fast, <1 s)
              └─ on fallback/404/network → Apps Script (JSONP), the authority
```

- **Publisher** — `apps-script/Publish.gs` builds the three payloads the page loads
  every visit (`data`, `fb`, `conv`) from the **same functions `doGet` uses**
  (`buildDataResponse_`, `fbData`, `convData`), gzips each, and POSTs the ones whose
  content changed to `<SITE_URL>/api/ingest` with `Authorization: Bearer
  <INGEST_SECRET>`. It also posts a tiny `index` holding only a **SHA-256 of the
  shared secret** (never the secret). A 5-minute time trigger runs it; every tool
  write republishes the affected payload right away (`publishSoon_`).
- **Read API** — `netlify/functions/api.mjs` (logic in `netlify/lib/fastapi.mjs`)
  serves `<site>/api?action=data|fbData|convData` from Netlify Blobs, taking the
  **same parameters** as the Apps Script API, so the page only changes its base URL.
  It verifies the caller by hashing the `secret` against the published index
  (same check as `requireSecret`), and serves the stored payload **still gzipped**
  (`Content-Encoding: gzip`), so multi-MB JSON is a couple hundred KB over the wire.
  `/api?action=ping` says whether anything is published, how many accounts, and when.
- **Page** — `fastRead()` tries `location.origin + '/api'` first for `data`/`fbData`/
  `convData`; a `{fallback:true}`, HTML/404, or network answer falls through to the
  Apps Script JSONP call (`jsonpRead`, which **retries up to 4×** on 404/429/5xx/network
  and shows a "Google is slow" note after 8 s). A missing function turns the fast path
  off for the visit. **Refresh** and post-write reloads go straight to Apps Script for
  the freshest numbers. Writes always go to Apps Script.
- **Access is unchanged.** One shared team secret, no per-client scoping — the fast
  path shows exactly what the Apps Script read showed, to exactly the same people.
- **Anything it can't positively verify** (nothing published, a secret it can't match,
  an action it doesn't serve like `slackUsers`/`changelog`) answers `{fallback:true}`
  and the page asks Apps Script. Tests: `npm test` (`tests/fastapi.test.mjs`) runs the
  real publisher into the real function and asserts the same answers, plus the security
  cases (bad/missing/short ingest secret, wrong/absent read secret, nothing published).
- **Known harmless difference:** the fast path can be up to ~5 minutes behind for a
  *passive* viewer (a write republishes within seconds for the person who made it; the
  5-minute cycle covers hand-edits and the hourly feed). **Refresh** always bypasses it.

### One-time setup
1. In the Sheet: **Lockhern Pacing → Fast loading: set up** (creates `INGEST_SECRET`,
   installs the 5-minute trigger, test-sends, and shows the secret to copy).
2. In Netlify: **Site configuration → Environment variables** → add `INGEST_SECRET`
   with that value.
3. **Deploys → Trigger deploy** (so the function picks up the env var).
4. Run **Fast loading: set up** again — it should now report "Fast loading is on."

`SITE_URL` in `Code.gs` (default `https://pacing.lockherndigital.com`) is where the
publisher POSTs; a Script Property `SITE_URL` overrides it. The gateway
(`Code.gs` + `Publish.gs`) auto-deploys from `main` via the clasp GitHub Action, and
Netlify builds the function on push (its build runs `npm test` first, so a commit that
fails the tests never publishes).
