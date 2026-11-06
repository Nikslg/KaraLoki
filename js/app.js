(() => {
  "use strict";
  const cfg = window.KARALOKI_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const DEVICE_KEY = "karaloki_device_id";
  const deviceId = getOrCreateDeviceId();
  let lastState = null;
  let countdownTarget = null;
  let countdownPaused = false;
  let busy = false;

  function getOrCreateDeviceId() {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : "dev-" + Date.now() + "-" + Math.random().toString(16).slice(2));
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  }

  function api(action, params = {}) {
    if (!cfg.API_URL || cfg.API_URL.includes("PASTE_YOUR")) return Promise.reject(new Error("The backend URL has not been configured yet."));
    return new Promise((resolve, reject) => {
      const callback = "kl_cb_" + Math.random().toString(36).slice(2);
      const query = new URLSearchParams({ action, deviceId, callback, ...params });
      const script = document.createElement("script");
      const timeout = setTimeout(() => finish(new Error("The server did not respond. Please try again.")), 15000);
      function finish(err, data) { clearTimeout(timeout); delete window[callback]; script.remove(); if (err) reject(err); else resolve(data); }
      window[callback] = (data) => { if (!data || data.ok !== true) return finish(new Error(data?.error || "Request failed.")); finish(null, data); };
      script.onerror = () => finish(new Error("Could not reach the backend. Check the Apps Script deployment URL."));
      script.src = cfg.API_URL + (cfg.API_URL.includes("?") ? "&" : "?") + query.toString();
      document.body.appendChild(script);
    });
  }

  function showMessage(id, message, isError = false) { $(id).textContent = message || ""; $(id).style.color = isError ? "#ff9c9c" : ""; }
  function formatTime(seconds) { const s = Math.max(0, Math.floor(seconds || 0)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); }

  function render(state) {
    lastState = state;
    const current = state.current;
    $("current-song").textContent = current ? `${current.song} – ${current.artist}` : "Nothing is playing yet";
    $("current-requester").textContent = current ? `Requested by ${current.requester}` : "Be the first to request a song";
    $("playback-state").textContent = state.paused ? "Paused" : (current ? "Playing" : "Waiting");
    countdownPaused = !!state.paused;
    countdownTarget = current && !countdownPaused ? Date.now() + Math.max(0, Number(state.remainingSeconds) || 0) * 1000 : null;
    $("countdown").textContent = current ? formatTime(state.remainingSeconds) : "—";
    $("countdown").classList.toggle("paused", countdownPaused);
    const list = $("queue-list"); list.replaceChildren();
    $("queue-count").textContent = `${state.queue.length} song${state.queue.length === 1 ? "" : "s"}`;
    if (!state.queue.length) { const li = document.createElement("li"); li.className = "empty"; li.textContent = "The queue is empty. Add the first song!"; list.appendChild(li); }
    else state.queue.forEach((item, index) => {
      const li = document.createElement("li"); li.className = "queue-item";
      const num = document.createElement("span"); num.className = "queue-number"; num.textContent = String(index + 1).padStart(2, "0");
      const body = document.createElement("div");
      const song = document.createElement("div"); song.className = "queue-song"; song.textContent = `${item.song} – ${item.artist}`;
      const requester = document.createElement("div"); requester.className = "queue-requester"; requester.textContent = `Requested by ${item.requester}`;
      body.append(song, requester); li.append(num, body); list.appendChild(li);
    });
  }

  async function refresh() { try { const result = await api("state"); render(result.state); } catch (e) { if (!lastState) showMessage("request-message", e.message, true); } }

  $("request-form").addEventListener("submit", async (event) => {
    event.preventDefault(); if (busy) return;
    const songText = $("song-input").value.trim(); const requester = $("requester-input").value.trim();
    const split = songText.split(/\s+[–—-]\s+/);
    if (split.length < 2 || !split[0].trim() || !split.slice(1).join(" - ").trim()) return showMessage("request-message", "Enter the song and artist separated by a dash.", true);
    busy = true; $("request-button").disabled = true;
    try {
      const result = await api("add", { song: split[0].trim(), artist: split.slice(1).join(" - ").trim(), requester });
      $("song-input").value = ""; showMessage("request-message", result.message || "Song added!"); await refresh();
    } catch (e) { showMessage("request-message", e.message, true); }
    finally { busy = false; $("request-button").disabled = false; }
  });

  setInterval(() => { if (countdownTarget !== null && !countdownPaused) $("countdown").textContent = formatTime(Math.max(0, Math.ceil((countdownTarget - Date.now()) / 1000))); }, 1000);
  refresh(); setInterval(refresh, Math.max(5000, Number(cfg.REFRESH_MS) || 10000));
})();
