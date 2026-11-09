# KaraLoki v1.8.5 — очередь караоке и панель ведущего

KaraLoki — веб-приложение для очереди песен. Сайт размещается на GitHub Pages, данные хранятся в Google Sheets, серверная логика работает через Google Apps Script.

## Изменения v1.8.5

- Playback actions (Пауза/Продолжить/Пропустить/Режим) update the Admin client immediately and are sent to Apps Script sequentially in click order, allowing rapid consecutive Pause/Resume actions.
- Admin navigation remains in its own top panel. Playback controls are available only on the Queue tab and share one panel with the Admin song-request form. The Admin tab panels have consistent vertical gaps, matching the Guest-side panel spacing.
- Admin tab panels use consistent vertical spacing, matching the Guest panel's card separation.
- Guest account actions are ordered «Изменить имя» then «Выйти», with the exit action below the rename action.
- Version labels and file descriptions updated to v1.8.5.


KaraLoki — веб-приложение для очереди песен. Сайт размещается на GitHub Pages, данные хранятся в Google Sheets, серверная логика работает через Google Apps Script.

## Что входит в v1.8.1

- Добавлены кнопки ↑ и ↓ для ручного перемещения любой ожидающей песни, включая первые три позиции. Текущую и предыдущие песни перемещать нельзя.
- Ручное перетаскивание также работает для любой ожидающей песни; оно не ограничено правилами Shuffle.
- Сервер принимает полный новый порядок ожидающей очереди и проверяет, что каждая ожидающая песня присутствует ровно один раз.
- Во время перетаскивания автоматическое обновление списка приостанавливается, чтобы не сбрасывать перемещение.
- Большая кнопка Shuffle заменена компактной иконкой рядом с «Очистить очередь».
- Shuffle по-прежнему защищает первые три ожидающие песни и доступен только при наличии минимум двух песен после них (то есть от пяти ожидающих песен).
- Список подтверждённых пользователей получил собственную ограниченную по высоте область прокрутки.

## Что входит в v1.7.5

- Удалена зависимость от `requestToken` / `requesterToken`: cooldown, бан и личная подсветка привязаны к имени подтверждённого пользователя. Устройства с одинаковым именем видят одинаковые личные подсветки.
- Исправлена отправка песен гостями и RadioLoki без device token.
- Колонка `requesterToken` (и устаревшая `deviceId`, если осталась) удаляется миграцией `setupKaraLoki()`. Данные песен и история при этом сохраняются.
- Личная подсветка ожидающих песен работает по имени; подсветка исчезает, когда песня становится текущей.
- Кнопки «Пауза», «Пропустить» и «Режим» размещены в одной строке, включая узкие экраны.

## Что входит в v1.7

- Убраны ежедневный код комнаты и DeviceID.
- Гость входит по имени. Новое имя отправляется ведущему на подтверждение.
- Ранее подтверждённое имя узнаётся автоматически; повторное подтверждение при обычном входе не требуется.
- Новое имя получает сообщение: «Запрос отправлен. Ожидайте подтверждения Администратора.»
- Уже ожидающее имя получает сообщение: «Ожидайте подтверждения Администратора.»
- Подтверждённое имя получает приветствие: «Добро пожаловать [имя]».
- Имя и 15-минутное ожидание хранятся на стороне Google Sheets, а не в DeviceID.
- Ведущий может одобрить или отклонить ожидающее имя.
- Подтверждённого пользователя можно вернуть в список ожидающих через кнопку 🚫; доступ к заказам блокируется до повторного одобрения.
- Для пользователя доступны: снять ожидание, временно ограничить заказы на 30 минут, вернуть на подтверждение.
- Вкладки панели: «Очередь», «История», «Пользователи» и «Настройки».
- Администраторская очередь объединяет две предыдущие песни, текущую и все ожидающие; у ожидающих отображается время заявки, а перетаскивание через ✥ меняет порядок.
- Кнопка «Перемешать» случайно меняет порядок песен после первых трёх ожидающих, если таких песен не менее двух.
- Режим мероприятия временно блокирует новые гостевые заявки, не останавливая текущую песню и не закрывая управление ведущему.
- Настраиваются автопереход, длительность слота и задержка между заявками.
- История вынесена в отдельную вкладку; «Очистить» помечает записи, не удаляя строки из Google Sheets.
- Публичная очередь подсвечивает ожидающую песню только на устройстве её заказчика; подсветка исчезает, когда песня становится текущей.
- При первом подключении показывается экран загрузки; временное ожидание ответа сервера не отображается как ошибка ввода имени.
- Публичная очередь показывает две предыдущие песни, текущую песню и все ожидающие песни; список прокручивается при большой очереди.
- Кнопка ▶ в истории добавляет выбранную песню следующей после текущей, не прерывая текущий трек; это работает и для записей «Удалена». Записи также можно скрывать и удалять.
- Удаление песни из очереди и очистка ожидающей очереди снимают ожидание затронутых пользователей.
- Добавлен адаптивный тёмный фон с неоновой эмблемой микрофона с рогами; отдельный логотип не добавлялся, заголовок KaraLoki оставлен текстовым.
- Оформление учитывает настольные и мобильные экраны. Фон не перекрывает элементы управления.
- Фоновый опрос — каждые 5 секунд; локальные таймеры обновляются каждую секунду по серверной отметке времени. На нуле клиент немедленно запрашивает атомарный переход; сервер фиксирует его один раз.
- Длительность песни в настройках задаётся только в формате М:СС (например, 5:00 или 4:30).
- Переход между гостевой и административной страницами показывает экран загрузки; гостевой выход перемещён в заголовок блока заказа песни.
- Сохранён пятиминутный слот воспроизведения и управление паузой/пропуском; «Пропустить» срабатывает без дополнительного подтверждения.

## Важное ограничение имени как идентификатора

Имя — это идентификатор гостя, а не защищённая учётная запись. Любой человек, знающий подтверждённое имя, может войти под ним и разделить с его владельцем ожидание и ограничения. Система не может надёжно различать двух людей с одинаковым именем.

`RadioLoki` остаётся общим идентификатором удобства для доступа ведущего, а не безопасной аутентификацией. Не используйте эту схему для конфиденциальных данных.

## Обновление с предыдущей версии

1. Сделайте копию Google-таблицы перед изменениями.
2. Откройте существующую таблицу → **Расширения → Apps Script**.
3. Полностью замените `Code.gs` содержимым `google-apps-script/Code.gs` из архива и сохраните.
4. Проверьте, что Script Property `SPREADSHEET_ID` указывает на вашу существующую таблицу.
5. Запустите `setupKaraLoki()` один раз после обновления. Эта процедура проверяет структуру и удаляет только устаревшие колонки `requesterToken` / `deviceId` из Queue/History; записи песен, пользователей и истории сохраняются. Не удаляйте существующие вкладки.
6. Откройте **Развернуть → Управление развертываниями**, отредактируйте существующее веб-приложение, выберите **Новая версия** и разверните.
7. Скопируйте URL веб-приложения `/exec`, если он изменился, и вставьте его в `js/config.js`.
8. Замените файлы сайта в корне GitHub-репозитория содержимым папки `KaraLoki` из архива. Не загружайте ZIP как единственный файл и не создавайте лишнюю вложенную папку.
9. Дождитесь обновления GitHub Pages и проверьте публичную страницу и `admin.html`.

Настройки развертывания Apps Script должны позволять гостям обращаться к веб-приложению. Обычно это «Выполнять от имени: Я» и доступ «Все». Не предоставляйте гостям доступ к самой Google-таблице.

## Первичная настройка с нуля

1. Создайте Google-таблицу и скопируйте её ID из URL.
2. Откройте **Расширения → Apps Script** и замените `Code.gs` кодом из архива.
3. В **Настройки проекта → Свойства скрипта** добавьте `SPREADSHEET_ID` со значением ID таблицы.
4. Сохраните и запустите `setupKaraLoki()`, подтвердите разрешения Google. Это также выполнит безопасную миграцию устаревших полей идентификатора устройства.
5. Разверните как веб-приложение, выполняемое от вашего имени и доступное гостям.
6. Вставьте URL `/exec` в `js/config.js`.
7. Загрузите содержимое папки `KaraLoki` в GitHub-репозиторий и включите GitHub Pages.

## Проверка после установки

- Новое имя показывает первое сообщение и появляется в Pending.
- Повторный вход с уже ожидающим именем показывает второе сообщение.
- Одобренное имя входит без повторного одобрения и получает приветствие.
- Отклонённое имя может подать заявку повторно.
- Кнопка 🚫 возвращает подтверждённого пользователя в Pending и блокирует заказы до повторного одобрения.
- Проверить снятие ожидания, 30-минутную блокировку и возврат пользователя кнопкой 🚫; также проверить снятие ожидания при удалении песни/очистке очереди.
- Проверить две предыдущие песни, текущую песню и длинную прокручиваемую очередь; в истории проверить ▶ (добавление следующей песни без прерывания текущей), Hide и Delete.
- Проверить фоновой опрос 5 секунд и немедленное обновление после действий.

## Данные Google Sheets

- `Queue` — запросы и их статусы.
- `Playback` — текущая песня, пауза и таймер.
- `History` — история исполнения, скрытия и удаления.
- `Users` — имя, нормализованный ключ, статус, окончание ожидания, окончание временной блокировки и даты создания/обновления.

Очистка очереди меняет статус ожидающих строк на `Cleared`, не удаляя их из листа `Queue` и не очищая `History`.


## v1.8.2 — Admin responsiveness and guest name changes

## v1.8.3 — Server-synchronized local playback timer and UI refinements

- Pending-user approvals now update the list immediately and run independently, so multiple guests can be approved without waiting for each other. Failed approvals restore the row and show the server error.
- Queue up/down controls update optimistically and reconcile with the Google Sheets backend. Drag-and-drop remains available.
- History playback buttons remain locked while the server processes the request.
- Added a compact admin loading indicator for server-backed actions.
- Added guest name changes on both pending and confirmed guest screens, plus admin rename controls. Rename preserves the user's approval state, cooldown, ban state, and updates requester names in queue/history. Names remain unique case-insensitively.
- Confirmed-user list is more compact and scrollable; shuffle and clear controls remain right-aligned with a consistent SVG icon.

**Deployment:** back up the existing Google Sheet, replace `Code.gs` in the existing Apps Script project, deploy a new web-app version, and keep the same `/exec` URL in `js/config.js`. Then replace the GitHub Pages project files with this archive. Do not run setup against a new spreadsheet.

**Identity limitation:** KaraLoki uses guest display names as identities rather than passwords or device tokens. Name changes therefore preserve the existing name-based identity model and should not be treated as secure account authentication.

### Изменения v1.8.3

- Google Apps Script возвращает серверное время и точное время окончания текущей песни. Браузеры считают таймер локально, не опрашивая таблицу каждую секунду.
- При достижении нуля клиент сразу вызывает `advanceIfExpired`; серверная блокировка защищает от двойного перехода между песнями.
- Сохранение длительности пересчитывает тайминг текущего трека; поле настроек принимает только формат `M:SS` (1:00–30:00).
- Исправлена подпись заказа песни в Admin; добавлен отступ между трэклистом и формой заказа гостя; кнопка выхода гостя перенесена в заголовок формы.
- Добавлен экран загрузки при переходе между гостевой и административной страницами.

**Важно:** после обновления фронтенда обязательно замените `Code.gs` и разверните новую версию Apps Script. Старый `/exec` URL остаётся тем же.


## v1.8.4 — Instant playback controls and unified Admin layout

- Pause, Resume, Skip and Event Mode now update the Admin interface optimistically before the Apps Script request completes. A compact pending notification remains visible during the background save; on failure the previous state is restored and an error is shown.
- Pause freezes the locally calculated remaining time immediately. Resume restarts from the preserved remaining time. Skip immediately previews the next queued song while the backend confirms the transition.
- Admin tabs remain at the top. Playback controls are integrated directly beneath them in the same unified Admin panel; the separate adjacent playback card is removed.
- Pause and Resume share one toggle button; only the action appropriate to the current state is shown. Skip and the existing Event Mode control remain available.
- Admin «Выйти» remains in the top-right heading position, matching the Guest panel's account-action placement.
- Guest «Изменить имя» is grouped directly under the displayed guest name and «Выйти» control.
- «Добро пожаловать [имя]» is displayed in the Guest connection/loading overlay instead of inside the request panel.
- Guest Tracklist and song-request panels use an explicit shared 16px layout gap, matching Admin section spacing.

**Deployment:** back up the existing Google Sheet, replace `Code.gs` in the existing Apps Script project with the included file, deploy a new web-app version, then replace the GitHub Pages files with this archive. Keep the existing spreadsheet and `/exec` endpoint.
