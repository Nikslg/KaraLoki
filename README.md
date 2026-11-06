# KaraLoki v1.1 — public queue + host controls

A small karaoke request queue for GitHub Pages, using Google Sheets as its database and Google Apps Script as its backend.

## What's included

- Public page (`index.html`) with song requests, upcoming queue, current song and visible five-minute `MM:SS` countdown.
- Separate host page (`admin.html`) with Back, Pause/Resume and Forward controls.
- Host queue tools: move waiting songs up/down and remove individual waiting requests.
- Browser/device ID limit: one active request per browser profile.
- Shared Google Sheets storage for queue, playback state and history.
- Both pages refresh from the same backend every 10 seconds.

## Owner access: important limitation

The requested owner flow is implemented: enter `RadioLoki` on `admin.html` to open host controls. There is **no separate password**. The backend checks the owner name for every administrative action, not just the page display.

However, `RadioLoki` is a shared name, not a secret. Anyone who knows it can use the admin actions, including by calling the public Apps Script endpoint directly. This is appropriate only for a trusted/private party where that trade-off is acceptable. Do not use this design for sensitive or publicly exposed administration. A stronger secret or Google-account allowlist would be needed for real security.

## If you already configured the v1.0 starter

You can keep your existing Google spreadsheet and Apps Script project; do not create a second database just for this update. Replace the existing Apps Script `Code.gs` contents with the new `google-apps-script/Code.gs`. Keep the existing `SPREADSHEET_ID` Script Property. The old `OWNER_PASSWORD_HASH` property is no longer used and may be deleted. Then open **Deploy → Manage deployments**, edit the existing web-app deployment, select **New version**, and deploy it. Keep the same `/exec` web-app URL in `js/config.js` if the deployment URL remains unchanged. Upload the updated website files to the existing GitHub repository, preserving the root folder structure.

## Part A — create the Google Sheet (this is the Google integration)

KaraLoki uses **Google Sheets**, not Google Docs. Sheets is the correct Google product for structured rows such as songs, requester IDs, queue positions and playback state. A Google Doc is a word-processing document and is not used as the live database.

1. Open [Google Sheets](https://sheets.google.com) and create a blank spreadsheet named `KaraLoki Database`.
2. Copy the spreadsheet ID from its URL. It is the long value between `/d/` and `/edit` in a URL like `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`.
3. Keep the spreadsheet private. Do not publish it or give guests editor access.
4. You do not need to create tabs manually. `setupKaraLoki()` creates `Queue`, `Playback` and `History`.

### Connect Apps Script to the Sheet

1. In the spreadsheet, choose **Extensions → Apps Script**.
2. In the Apps Script editor, open `Code.gs`, select all, and replace it with the contents of this project's `google-apps-script/Code.gs`.
3. In Apps Script, open **Project Settings → Script properties → Add script property**.
4. Add `SPREADSHEET_ID` and paste the spreadsheet ID as its value.
5. Save the project.
6. Select `setupKaraLoki` in the function dropdown and click **Run**. Approve the requested Google Sheets permissions. The three tabs should appear in your spreadsheet.

### Deploy the Apps Script web app

1. In Apps Script choose **Deploy → New deployment**.
2. Select the gear icon and choose **Web app**.
3. Set **Execute as** to **Me**.
4. Set **Who has access** to **Anyone** so guests can submit song requests. The app checks the owner name for admin actions, but remember that the shared name is not secure authentication.
5. Click **Deploy** and complete any authorization prompts.
6. Copy the web app URL ending in `/exec`.

## Part B — configure the website

1. Open `js/config.js` in the project.
2. Replace `PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE` with the `/exec` URL copied above. Keep the quotation marks.
3. Save the file.

## Part C — extract the ZIP and publish on GitHub Pages

### 1. Extract the downloaded project

1. Download the KaraLoki ZIP to your computer.
2. On Windows: right-click the ZIP and choose **Extract All…**. On macOS: double-click the ZIP. On most Linux desktop environments: right-click and choose **Extract Here** or **Extract To…**.
3. Open the extracted `KaraLoki` folder. You should see `index.html`, `admin.html`, `README.md`, `.nojekyll`, plus the `css`, `js` and `google-apps-script` folders.
4. Important: upload the **contents inside** this `KaraLoki` folder to the GitHub repository root. Do not upload only the ZIP, and do not create an extra nested `KaraLoki/KaraLoki/` folder.

### 2. Create the GitHub repository

1. Sign in at [GitHub](https://github.com).
2. Click **New repository** and name it `KaraLoki`.
3. For the simplest Pages setup, choose **Public**. (A private repository's Pages availability depends on your GitHub plan and organization settings.)
4. Create the repository. If you are uploading files through the website, use **Add file → Upload files**.
5. Drag in the extracted project contents: `index.html`, `admin.html`, `.nojekyll`, `README.md`, `LICENSE.txt`, and the three folders `css`, `js`, `google-apps-script`. GitHub's browser uploader accepts folders in the upload area in supported browsers; if that is inconvenient, use GitHub Desktop.
6. Scroll down and click **Commit changes**.

### 3. Turn on GitHub Pages

1. In the repository, open **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select branch `main` and folder `/ (root)`, then click **Save**.
4. Wait for GitHub Pages to finish publishing. The public page will be `https://YOUR-USERNAME.github.io/KaraLoki/`.
5. The host page will be `https://YOUR-USERNAME.github.io/KaraLoki/admin.html`.

### Updating the site later

When you change project files, upload/commit the changed files to the same repository while preserving the folder structure. GitHub Pages republishes the site automatically after the commit.

## Testing checklist

- Open the public URL on a phone and computer; confirm the current song and `MM:SS` countdown are visible.
- Submit one song from browser/device A. A second active request from that same browser should be rejected.
- Submit from a different browser/device; it should be accepted.
- Open `/admin.html`, enter `RadioLoki`, and confirm host controls appear.
- Test Pause and Resume; the countdown should freeze and continue.
- Test Forward; the current song should be recorded as Skipped and the next song should start.
- Test Back after a song has completed or been skipped; the previous song should return with a fresh five-minute slot.
- Add several waiting songs; test moving them up/down and removing one.
- Check that `Queue`, `Playback` and `History` in the Google Sheet update.

## How the five-minute timer works

The countdown is based on a shared timestamp in the `Playback` sheet, so the public page and admin page display the same remaining time. It is a queue slot timer, not audio playback detection. The backend advances a song when a page polls the state after the slot expires. If nobody has either page open, the next song may not advance until the next poll after someone returns. The website polls every 10 seconds; this is not instant push.

## Security and operational notes

- The Apps Script endpoint is public so guests can submit requests. The spreadsheet itself should remain private.
- The frontend uses JSONP GET requests for GitHub Pages cross-origin compatibility. Query values may appear in browser history, logs or network diagnostics.
- The owner name `RadioLoki` is deliberately not a password. Anyone who knows it can administer the queue. The backend verifies the name on each admin action, but this does not make the name secret.
- Device IDs are stored in browser local storage. Clearing site data or switching browsers creates a new ID; this is a casual party limit, not identity verification.
- Apps Script has quotas and execution limits. This prototype is intended for a small party.
- Google Sheets is the live data store. Google Docs is not part of the runtime integration.
