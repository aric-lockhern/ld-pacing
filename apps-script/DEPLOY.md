# Auto-deploying the gateway (Code.gs) from git

The front-end deploys to Netlify automatically on every push to `main`. The
**gateway** (`Code.gs`) runs in **Google Apps Script**, which does *not* sync
from GitHub on its own. This sets up a GitHub Action so that a push to `main`
touching `apps-script/**` **pushes the code to Apps Script and redeploys the
web app in place** — same `/exec` URL, no manual copy-paste.

> After this is set up once, changing `Code.gs` + pushing to `main` is all it
> takes. The Action (`.github/workflows/deploy-gateway.yml`) does the rest.

## One-time setup (you, in a browser + terminal)

You need Node installed locally for the two `clasp` commands below.

1. **Enable the Apps Script API** for the Google account that owns the script:
   <https://script.google.com/home/usersettings> → turn **Google Apps Script API**
   **ON**.

2. **Install clasp and log in** (this creates the credential the CI uses):
   ```bash
   npm install -g @google/clasp@2.4.2
   clasp login          # opens a browser; approve with the gateway's Google account
   ```
   This writes `~/.clasprc.json`.

3. **Fill in the Script ID.** In the Apps Script editor: **Project Settings**
   (gear) → copy the **Script ID**. Put it in `apps-script/.clasp.json`
   (replace `PASTE_YOUR_SCRIPT_ID_HERE`), commit it.

4. **Pull the LIVE manifest** (safety-critical — keeps the web-app access
   settings intact so JSONP keeps working):
   ```bash
   cd apps-script
   clasp pull           # writes the real appsscript.json (and Code.gs)
   ```
   Commit the `appsscript.json` it creates. Review the diff to `Code.gs` first —
   it should already match what's in the repo.

5. **Add the credential as a GitHub secret.** Repo → **Settings → Secrets and
   variables → Actions → New repository secret**:
   - Name: `CLASPRC_JSON`
   - Value: the entire contents of `~/.clasprc.json`

6. (Optional) If the deployment ID ever changes, set a repo **variable**
   `APPS_SCRIPT_DEPLOYMENT_ID`. The default baked into the workflow is the
   current one (the token in the `/exec` URL).

## After setup

- Push a change to `Code.gs` → the **Deploy Apps Script gateway** Action runs →
  the gateway is live in ~30s, same URL.
- You can also trigger it manually: repo → **Actions → Deploy Apps Script
  gateway → Run workflow**.
- Verify it took: open `<WEBAPP_URL>/exec?action=setFbLeads` — a current gateway
  answers `{"ok":false,"error":"Error: bad secret"}`; a stale one answers
  `{"ok":true,"service":"Lockhern pacing gateway"}`.

## Notes / safety

- `~/.clasprc.json` is a login token for your Google account. It's git-ignored
  and lives only in the GitHub **secret** — never commit it.
- The Action **updates the existing deployment** (`clasp deploy --deploymentId`),
  so the `/exec` URL never changes.
- If `appsscript.json` is missing or the Script ID is still the placeholder, the
  Action **fails loudly and deploys nothing** — it won't half-break the gateway.
