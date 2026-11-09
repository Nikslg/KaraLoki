(() => {
  "use strict";
  const cfg = window.KARALOKI_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const DEVICE_KEY = "karaloki_device_id";
  const NAME_KEY = "karaloki_requester_name";
  const ROOM_KEY = "karaloki_room_password";
  const deviceId = getOrCreateDeviceId();
  let lastState = null, countdownTarget = null, countdownPaused = false;
  let cooldownUntil = 0, busy = false, refreshBusy = false;

  function getOrCreateDeviceId() {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : "dev-" + Date.now() + "-" + Math.random().toString(16).slice(2);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  }
  function api(action, params = {}) {
    if (!cfg.API_URL || cfg.API_URL.includes("PASTE_YOUR")) return Promise.reject(new Error("Сначала укажите URL Apps Script в файле js/config.js."));
    return new Promise((resolve, reject) => {
      const callback = "kl_cb_" + Math.random().toString(36).slice(2);
      const query = new URLSearchParams({ action, deviceId, callback, ...params });
      const script = document.createElement("script");
      const timeout = setTimeout(() => finish(new Error("Сервер не ответил. Попробуйте ещё раз.")), 15000);
      function finish(err, data) { clearTimeout(timeout); delete window[callback]; script.remove(); if (err) reject(err); else resolve(data); }
      window[callback] = (data) => data && data.ok ? finish(null, data) : finish(new Error(data?.error || "Не удалось выполнить запрос."));
      script.onerror = () => finish(new Error("Не удалось связаться с сервером. Проверьте URL Apps Script."));
      script.src = cfg.API_URL + (cfg.API_URL.includes("?") ? "&" : "?") + query.toString();
      document.body.appendChild(script);
    });
  }
  function msg(id, value, error = false) { $(id).textContent = value || ""; $(id).style.color = error ? "#ff9c9c" : ""; }
  function time(s) { s = Math.max(0, Math.floor(Number(s) || 0)); return String(Math.floor(s / 60)).padStart(2,"0") + ":" + String(s % 60).padStart(2,"0"); }
  function songLabel(item) { return item.artist ? `${item.song} — ${item.artist}` : item.song; }
  function setGate(open) { $("room-gate").classList.toggle("hidden", open); $("public-content").classList.toggle("hidden", !open); }

  function render(state) {
    lastState = state;
    const current = state.current;
    $("current-song").textContent = current ? songLabel(current) : "Пока ничего не играет";
    $("current-requester").textContent = current ? `Заказал(а): ${current.requester}` : "Будьте первым, кто закажет песню";
    $("playback-state").textContent = state.paused ? "Пауза" : (current ? "Играет" : "Ожидание");
    countdownPaused = !!state.paused;
    countdownTarget = current && !countdownPaused ? Date.now() + Math.max(0, Number(state.remainingSeconds) || 0) * 1000 : null;
    $("countdown").textContent = current ? time(state.remainingSeconds) : "—";
    $("countdown").classList.toggle("paused", countdownPaused);
    const list = $("queue-list"); list.replaceChildren();
    $("queue-count").textContent = `${state.queue.length} ${state.queue.length === 1 ? "песня" : "песен"}`;
    if (!state.queue.length) {
      const li = document.createElement("li"); li.className = "empty"; li.textContent = "Очередь пока пуста. Закажите первую песню!"; list.appendChild(li);
    } else state.queue.forEach((item, i) => {
      const li = document.createElement("li"); li.className = "queue-item";
      const num = document.createElement("span"); num.className = "queue-number"; num.textContent = String(i + 1).padStart(2,"0");
      const body = document.createElement("div"); body.className = "queue-item-body";
      const song = document.createElement("div"); song.className = "queue-song"; song.textContent = songLabel(item);
      const requester = document.createElement("div"); requester.className = "queue-requester"; requester.textContent = `Заказал(а): ${item.requester}`;
      body.append(song, requester); li.append(num, body); list.appendChild(li);
    });
    if (Number(state.cooldownRemaining) > 0) cooldownUntil = Date.now() + Number(state.cooldownRemaining) * 1000;
    updateCooldown();
  }
  function updateCooldown() {
    const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
    const active = remaining > 0;
    $("cooldown-box").classList.toggle("hidden", !active);
    $("cooldown-countdown").textContent = time(remaining);
    $("request-button").disabled = busy || active;
  }
  async function refresh() {
    if (refreshBusy) return; refreshBusy = true;
    try {
      const password = localStorage.getItem(ROOM_KEY) || "";
      const result = await api("state", { roomPassword: password });
      if (result.state && result.state.roomPasswordValid === false) throw new Error("ROOM_PASSWORD_EXPIRED");
      setGate(true); render(result.state);
    } catch (e) {
      if (e.message === "ROOM_PASSWORD_EXPIRED" || /код комнаты|пароль комнаты|room password/i.test(e.message)) {
        localStorage.removeItem(ROOM_KEY); setGate(false); msg("room-message", "Код комнаты недействителен. Введите актуальный код.", true);
      } else if (!lastState) msg("room-message", e.message, true);
    } finally { refreshBusy = false; }
  }

  $("requester-input").value = localStorage.getItem(NAME_KEY) || "";
  const savedPassword = localStorage.getItem(ROOM_KEY);
  if (!savedPassword) setGate(false);

  $("room-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = $("room-code").value.trim();
    if (!/^\d{4}$/.test(code)) return msg("room-message", "Введите код из четырёх цифр.", true);
    $("room-button").disabled = true;
    msg("room-message", "Проверяем код комнаты... ожидайте");
    try {
      await api("verifyRoom", { roomPassword: code });
      localStorage.setItem(ROOM_KEY, code); $("room-code").value = ""; msg("room-message", "");
      setGate(true); lastState = null; await refresh();
    } catch (e) { msg("room-message", e.message, true); }
    finally { $("room-button").disabled = false; }
  });

  $("request-form").addEventListener("submit", async (event) => {
    event.preventDefault(); if (busy) return;
    const song = $("song-input").value.trim(), artist = $("artist-input").value.trim(), requester = $("requester-input").value.trim();
    if (!song || !requester) return msg("request-message", "Укажите название песни и своё имя.", true);
    busy = true; $("request-button").disabled = true;
    $("request-button").classList.add("is-loading");
    msg("request-message", "Добавляем в очередь... ожидайте");
    try {
      localStorage.setItem(NAME_KEY, requester);
      const result = await api("add", { song, artist, requester, roomPassword: localStorage.getItem(ROOM_KEY) || "" });
      $("song-input").value = ""; $("artist-input").value = "";
      msg("request-message", result.message || "Песня добавлена в очередь.");
      cooldownUntil = Date.now() + 15 * 60 * 1000;
      await refresh();
    } catch (e) { msg("request-message", e.message, true); await refresh(); }
    finally { busy = false; $("request-button").classList.remove("is-loading"); updateCooldown(); }
  });

  setInterval(() => {
    if (countdownTarget !== null && !countdownPaused) $("countdown").textContent = time(Math.ceil((countdownTarget - Date.now()) / 1000));
    updateCooldown();
  }, 1000);
  refresh(); setInterval(refresh, Math.max(1000, Number(cfg.REFRESH_MS) || 5000));
})();
