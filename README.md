# KaraLoki v1.9.0

KaraLoki karaoke queue. The Public Queue and Admin interface remain hosted on GitHub Pages. Google Apps Script remains the backend and Google Sheets remains the database.

## What's included
- Original v1.8.7.2 project structure and Admin controls retained on GitHub Pages.
- v1.8.8 interaction improvements carried into the guest transfer flow: immediate pending feedback, duplicate-request prevention, three-minute countdown, expiry/rejection feedback, and disabled transfer decision buttons while the server processes the response.
- Exact guest greeting: `Добро пожаловать, $user$!`.
- Admin username and four-digit PIN are read from the private `Admin` sheet. No fixed Admin username is embedded in the frontend or backend source.
- PIN login uses a one-time challenge-response. The PIN itself is not sent in the JSONP URL. On first successful login, the backend replaces the plaintext four-digit PIN with a salted SHA-256 verifier.
- Server-side Admin sessions are required for privileged operations; sessions expire after 12 hours of inactivity.
- Failed Admin login attempts are rate-limited: five failures trigger a 15-minute lockout.
- Additive `Admin`, `AdminSessions`, and `Devices` sheets; existing queue/history rows are not cleared by the new initializer.

## Deployment (backup first)
1. Make a copy of your existing Google spreadsheet and Apps Script project.
2. In Apps Script, replace the existing `Code.gs` with `google-apps-script/Code.gs` from this archive and save.
3. Run `initializeAdminSheet()` once from the Apps Script editor and authorize it. It creates the `Admin`, `AdminSessions`, and `Devices` tabs only if they are missing. It does not run the legacy migration routine.
4. Open the `Admin` tab. Replace `CHANGE_ME` with your chosen Admin username and `0000` with your chosen four-digit PIN. Leave `enabled` as `true`. Do this before exposing the updated deployment.
5. Deploy a new version of the existing Apps Script web app. Keep the same deployment URL if you update the existing deployment.
6. Check `js/config.js` and make sure `API_URL` contains your Apps Script `/exec` URL. The archive retains the original placeholder if the uploaded source did not contain your live URL.
7. Upload the archive's GitHub Pages files (`index.html`, `admin.html`, `css/`, `js/`, and assets) to your existing repository.
8. Open `admin.html`, sign in with the username and PIN. After successful first login, the `pin` cell will contain a value beginning `sha256$` instead of the plaintext PIN.

## Resetting the Admin PIN
In the private `Admin` sheet, replace the `pin` cell with exactly four digits. On the next successful login, the backend hashes it again. No GitHub update is required. To change the Admin username, edit `username` in the same row.

## Important migration safety
- **Do not run `setupKaraLoki()` for this update.** The legacy setup function performs unrelated migrations.
- Do not delete or rename existing `Queue`, `Playback`, `History`, `Users`, `Sessions`, `SessionTransfers`, or `Settings` tabs.
- The initializer is additive. Still, take a spreadsheet backup before deployment.
- `Devices` stores browser-generated installation IDs from the existing client; these are not physical hardware identifiers and can be reset by clearing browser storage.

## Validation
JavaScript and Apps Script syntax checks were run on the packaged source. This is not a live integration test: the actual spreadsheet, Apps Script deployment permissions, and GitHub Pages configuration must be verified in your environment.
