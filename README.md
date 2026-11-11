# KaraLoki v1.9.4.6

KaraLoki karaoke queue. The Public Queue and Admin interface remain hosted on GitHub Pages. Google Apps Script remains the backend and Google Sheets remains the database.

## What's included
- Original v1.8.7.2 project structure and Admin controls retained on GitHub Pages.
- Session-transfer / guest-side "allow login" workflow removed. A username already in use remains occupied until its session expires after one hour of inactivity or an Admin force-logs it out.
- Admin online presence retained: green for heartbeat within 90 seconds, yellow for inactive but still within the one-hour session window, red for expired or revoked sessions.
- Guest heartbeat runs every 30 seconds only while the page is visible. It stops when the page becomes hidden and sends an immediate heartbeat when the page becomes visible again.
- Existing `SessionTransfers` sheet, if present, is left untouched for historical records; the application no longer reads or writes it.
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


## v1.9.2 UI updates
- Confirmed and pending user cards now share the same username and metadata alignment, font sizing, line spacing, and left indentation.
- Admin user labels are localized: `Cooldown` is now `Ожидание`; `Device` is now `Устройство`.
- Cooldown and action controls are vertically centred within the confirmed-user information row.
- Routine playback and queue actions use their local section feedback instead of also displaying the global floating loading notification. The global notification remains for Admin login/navigation loading.
- Public song submission now hides the song and artist fields while the request is in progress, disables the submit button, and uses a client-side duplicate-submission guard. Fields return after completion; on failure, entered values are preserved for retry.


## v1.9.3 UI and interaction corrections
- Admin confirmed and pending user cards share the same three-column geometry: user details on the left, the centered `Ожидание` column in the same fixed position, and action buttons on the right.
- Pending and confirmed user action buttons use matching square dimensions (50 px desktop, responsive reductions on narrow screens).
- The Admin `Снять ожидание / блокировку` action is enabled for either an active cooldown or temporary ban; the backend now clears both `cooldownUntil` and `bannedUntil`.
- Public and Admin song requests create a temporary semi-transparent pending queue card immediately after submission.
- Song and artist inputs are locked during submission, and submit buttons are disabled with a client-side duplicate-request guard.
- Admin song-request feedback is displayed inside the song-request form rather than the Queue panel.
- On success, temporary pending cards are replaced by server queue data and fields are cleared. On failure, temporary cards are removed and original input values remain for retry.


## v1.9.4.6 notification system
- Restored a global overlay notification panel on both Public Queue and Admin pages.
- Notifications cascade newest-first, with a maximum of four visible entries.
- Loading notices remain until cleared by their operation; success notices expire after four seconds; errors remain until dismissed or replaced.
- Repeated updates with the same message key replace that notification rather than creating duplicates.
- User-card-specific action feedback remains attached to its own user card; pending-song queue cards remain separate client-side optimistic UI elements.
- Updated public and Admin document titles to v1.9.4.6.


## v1.9.4.6 hotfix

- Added the missing Admin `unlocked()` panel-switching function.
- A previously rejected username can be reused during rename; only the stale `Denied` user record and its obsolete session/device records are cleared.
- Self-rename now preserves the active guest session, synchronizes the stored/input name, and ignores stale heartbeat/state responses sent under the previous name.
- Global notifications are positioned near the centre of the screen.

Apply the frontend files to GitHub Pages and replace `Code.gs` in the existing Apps Script project, then deploy a new Apps Script version. No spreadsheet reset or migration is required.


## v1.9.4.6 hotfix
- Declared queueDragActive to prevent the Admin refresh ReferenceError.
- Moved global notifications to top: 75%.
- Added cache-busting query versions to the shared stylesheet and Admin script.


## v1.9.4.6 — Страница Очередей
- Добавлена отдельная страница `queue.html` — только текущая композиция, статус воспроизведения и список очереди.
- Страница открыта для просмотра без входа, подтверждения имени и возможности менять порядок или отправлять заявки.
- В нижней навигации добавлена ссылка «Страница Очередей» слева от панели ведущего.
- Исправлена гонка heartbeat при переименовании пользователя: перед сменой имени клиент дожидается незавершённого heartbeat, а ответ со старой идентичностью не может завершить новую сессию.
- Повторное использование ранее отклонённого имени очищает все совпадающие исторические записи Denied, но по-прежнему блокируется при наличии любого активного совпадения.
- Обновлены cache-busting версии CSS и JavaScript.
- Сохранены изменения v1.9.4.2, включая уведомления на позиции 75% экрана и исправления Admin UI.


## v1.9.4.6 — Navigation and login-notice hotfix
- Global notifications are positioned at 25% from the top of the viewport.
- The guest login progress notification is cleared immediately after a successful server response.
- Restored consistent three-way bottom navigation on all three pages: Public panel (left), Queue page (centre), Admin panel (right).
- Added clearer Admin state-response validation and automatic return to login when the backend reports an expired Admin session.
- Updated cache-busting version on CSS and JavaScript references.


## v1.9.4.6
- Restored Admin queue and history rendering helpers, including queue controls and history actions.
- Moved global notifications to 20% from the top of the viewport.
