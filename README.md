# Lockhern — Account Pacing

Internal dashboard for pacing Google + Microsoft ad accounts against monthly
budgets. Live at **https://pacing.lockherndigital.com**.

## What's in here

| Path | What it is | Where it runs |
| --- | --- | --- |
| `index.html` | The entire front-end (one self-contained file — HTML, CSS, JS). | **Netlify** (this repo). |
| `apps-script/Code.gs` | The "gateway" — reads/writes the private Google Sheet, posts Slack alerts. | **Google Apps Script** (deployed separately as a web app). Kept here for version control only; secrets are redacted. |
| `netlify.toml` | Netlify build/publish config. | Netlify. |

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

The real `SLACK_WEBHOOK_URL` and `SLACK_BOT_TOKEN` live only in the deployed
Apps Script project — they are **redacted** in this repo. Never commit the real
values (GitHub secret scanning will block the push, and this feeds a public
site).

## Facebook tab

`facebook.js` adds a **Facebook** tab that reuses the same pacing engine. It's
fed from a **separate** Google Sheet (`FB - Daily`, campaign-level by date),
read through the gateway's `fbData` action.

- Only rows whose **`Active` column = "Active"** are served — unmanaged accounts
  never reach the browser. The gateway also trims to the last 95 days.
- Two levels: an **account rollup** row, expandable to **per-campaign pacing**
  (each campaign has its own monthly budget).
- Campaign budgets are stored in a `Facebook_Budgets` tab in the main sheet
  (`Account · Campaign · Month · Mode · Amount`), separate from Google/Microsoft
  budgets. A campaign's budget defaults to the sheet's **Daily budget × days in
  month** until set, or can use **last month's spend** or a **manual** amount.

To point at a different FB spreadsheet/tab, edit `FB_SPREADSHEET_ID` / `FB_TAB`
in `Code.gs`. The gateway's Google account must have access to that spreadsheet,
and **you must redeploy the gateway as a new version** after editing `Code.gs`.

## Config

`DEFAULT_WEBAPP_URL` and `DEFAULT_SECRET` at the top of `index.html` point the
front-end at the gateway for the whole team. The in-app **Settings** tab can
override them per-browser, but the committed defaults are what everyone gets.
