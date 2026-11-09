(() => {
  "use strict";
  const cfg = window.KARALOKI_CONFIG || {}, $ = (id) => document.getElementById(id);
  const OWNER_NAME = "RadioLoki", ADMIN_KEY = "karaloki_admin_unlocked";
  let ownerName = sessionStorage.getItem(ADMIN_KEY) === "1" ? OWNER_NAME : "";
  let lastState = null, countdownTarget = null, countdownPaused = false, busy = false, refreshBusy = false;

  function api(action, params = {}) {
    if (!cfg.API_URL || cfg.API_URL.includes("PASTE_YOUR")) return Promise.reject(new Error("Сначала укажите URL Apps Script в js/config.js."));
    return new Promise((resolve, reject) => {
      const callback = "kl_admin_cb_" + Math.random().toString(36).slice(2);
      const query = new URLSearchParams({ action, callback, ...params });
      const script = document.createElement("script");
      const timeout = setTimeout(() => finish(new Error("Сервер не ответил.")), 15000);
      function finish(err, data) { clearTimeout(timeout); delete window[callback]; script.remove(); err ? reject(err) : resolve(data); }
      window[callback] = (data) => data && data.ok ? finish(null, data) : finish(new Error(data?.error || "Не удалось выполнить запрос."));
      script.onerror = () => finish(new Error("Не удалось связаться с Apps Script."));
      script.src = cfg.API_URL + (cfg.API_URL.includes("?") ? "&" : "?") + query.toString();
      document.body.appendChild(script);
    });
  }
  function time(s) { s = Math.max(0, Math.floor(Number(s) || 0)); return String(Math.floor(s/60)).padStart(2,"0") + ":" + String(s%60).padStart(2,"0"); }
  function label(item) { return item.artist ? `${item.song} — ${item.artist}` : item.song; }
  function message(id, value, error = false) { $(id).textContent = value || ""; $(id).style.color = error ? "#ff9c9c" : ""; }
  function unlocked(on) { $("login-panel").classList.toggle("hidden", on); $("admin-content").classList.toggle("hidden", !on); }

  function button(text, title, handler, extra = "") {
    const b = document.createElement("button"); b.type = "button"; b.className = "icon-button secondary " + extra;
    b.textContent = text; b.title = title; b.setAttribute("aria-label", title); b.addEventListener("click", handler); return b;
  }
  function renderList(listId, items, mode) {
    const list = $(listId); list.replaceChildren();
    if (!items || !items.length) { const li = document.createElement("li"); li.className = "empty"; li.textContent = mode === "history" ? "История пока пуста." : "Очередь пуста."; list.appendChild(li); return; }
    items.forEach((item, i) => {
      const li = document.createElement("li"); li.className = "queue-item admin-queue-item";
      const num = document.createElement("span"); num.className = "queue-number"; num.textContent = mode === "history" ? "◷" : String(i+1).padStart(2,"0");
      const body = document.createElement("div"); body.className = "queue-item-body";
      const song = document.createElement("div"); song.className = "queue-song"; song.textContent = label(item);
      const requester = document.createElement("div"); requester.className = "queue-requester"; requester.textContent = `${item.requester || "—"}${item.result ? " · " + historyStatus(item.result) : ""}`;
      body.append(song, requester);
      const actions = document.createElement("div"); actions.className = "queue-actions";
      actions.append(button("▶", "Воспроизвести сейчас", () => adminAction("play", { songId: item.id })));
      if (mode === "queue") {
        const up = button("↑", "Переместить выше", () => adminAction("move", { songId:item.id, direction:"up" })); up.disabled = i === 0;
        const down = button("↓", "Переместить ниже", () => adminAction("move", { songId:item.id, direction:"down" })); down.disabled = i === items.length-1;
        actions.append(up, down, button("×", "Удалить из очереди", () => queueAction("remove", item.id), "remove-button"));
      }
      li.append(num, body, actions); list.appendChild(li);
    });
  }
  function historyStatus(s) { return ({Completed:"Исполнена",Skipped:"Пропущена",Interrupted:"Прервана",Replayed:"Повтор"})[s] || s; }

  function render(state) {
    lastState = state;
    const c = state.current;
    $("current-song").textContent = c ? label(c) : "Пока ничего не играет";
    $("current-requester").textContent = c ? `Заказал(а): ${c.requester}` : "Нет активного заказа";
    $("playback-state").textContent = state.paused ? "Пауза" : (c ? "Играет" : "Ожидание");
    countdownPaused = !!state.paused;
    countdownTarget = c && !countdownPaused ? Date.now() + Math.max(0, Number(state.remainingSeconds)||0)*1000 : null;
    $("countdown").textContent = c ? time(state.remainingSeconds) : "—";
    $("countdown").classList.toggle("paused", countdownPaused);
    $("pause-button").textContent = state.paused ? "▶ Продолжить" : "Ⅱ Пауза";
    $("daily-room-code").textContent = state.roomCode || "----";
    renderList("queue-list", state.queue || [], "queue");
    renderList("history-list", state.history || [], "history");
    $("queue-count").textContent = `${(state.queue||[]).length} песен`;
    $("history-count").textContent = String((state.history||[]).length);
  }
  async function refresh() {
    if (!ownerName || refreshBusy) return; refreshBusy = true;
    try { const result = await api("state", { ownerName }); render(result.state); }
    catch (e) { if (!lastState) message("control-message", e.message, true); }
    finally { refreshBusy = false; }
  }
  async function adminAction(action, params = {}) {
    if (busy) return; busy = true;
    try {
      await api(action, { ownerName, ...params }); await refresh();
      const texts = {skip:"Текущая песня пропущена.",pause:"Воспроизведение приостановлено.",resume:"Воспроизведение продолжено.",play:"Выбранная песня запущена.",clearQueue:"Очередь очищена.",add:"Песня добавлена."};
      message("control-message", texts[action] || "Изменения сохранены.");
    } catch (e) { message("control-message", e.message, true); }
    finally { busy = false; }
  }
  async function queueAction(action, songId) {
    if (action === "remove" && !confirm("Удалить эту песню из очереди?")) return;
    await adminAction(action, { songId });
  }

  $("admin-login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const entered = $("owner-name").value.trim();
    try {
      await api("adminCheck", { ownerName: entered });
      ownerName = OWNER_NAME; sessionStorage.setItem(ADMIN_KEY, "1"); unlocked(true);
      $("owner-name").value = ""; message("control-message", "Панель управления открыта."); await refresh();
    } catch (_) { message("login-message", "Не удалось выполнить вход. Проверьте данные и попробуйте снова.", true); }
  });
  $("lock-button").addEventListener("click", () => {
    ownerName = ""; sessionStorage.removeItem(ADMIN_KEY); lastState = null; unlocked(false); $("owner-name").value = ""; message("login-message", "");
  });
  $("skip-button").addEventListener("click", () => { if (confirm("Пропустить текущую песню и включить следующую?")) adminAction("skip"); });
  $("pause-button").addEventListener("click", () => adminAction(lastState?.paused ? "resume" : "pause"));
  $("clear-queue-button").addEventListener("click", () => { if (confirm("Очистить все ожидающие песни? История в Google Sheets останется без изменений.")) adminAction("clearQueue"); });
  $("copy-room-code").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("daily-room-code").textContent); message("control-message", "Код скопирован."); }
    catch (_) { message("control-message", "Не удалось скопировать код. Выделите его вручную.", true); }
  });
  $("admin-request-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const song = $("admin-song-input").value.trim(), artist = $("admin-artist-input").value.trim();
    if (!song) return message("control-message", "Введите название песни.", true);
    await adminAction("add", { song, artist, requester: OWNER_NAME, deviceId:"admin-" + OWNER_NAME });
    $("admin-song-input").value = ""; $("admin-artist-input").value = "";
  });

  unlocked(!!ownerName);
  setInterval(() => { if (countdownTarget !== null && !countdownPaused) $("countdown").textContent = time(Math.ceil((countdownTarget-Date.now())/1000)); }, 1000);
  refresh(); setInterval(refresh, Math.max(5000, Number(cfg.REFRESH_MS)||7000));
})();
