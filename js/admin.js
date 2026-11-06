(() => {
  "use strict";
  const cfg = window.KARALOKI_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const OWNER_NAME = "RadioLoki";
  const ADMIN_KEY = "karaloki_admin_unlocked";
  let ownerName = sessionStorage.getItem(ADMIN_KEY) === "1" ? OWNER_NAME : "";
  let lastState = null;
  let countdownTarget = null;
  let countdownPaused = false;
  let busy = false;

  function api(action, params = {}) {
    if (!cfg.API_URL || cfg.API_URL.includes("PASTE_YOUR")) return Promise.reject(new Error("The backend URL has not been configured yet."));
    return new Promise((resolve, reject) => {
      const callback = "kl_admin_cb_" + Math.random().toString(36).slice(2);
      const query = new URLSearchParams({ action, callback, ...params });
      const script = document.createElement("script");
      const timeout = setTimeout(() => finish(new Error("The server did not respond. Please try again.")), 15000);
      function finish(err, data) { clearTimeout(timeout); delete window[callback]; script.remove(); if (err) reject(err); else resolve(data); }
      window[callback] = (data) => { if (!data || data.ok !== true) return finish(new Error(data?.error || "Request failed.")); finish(null, data); };
      script.onerror = () => finish(new Error("Could not reach the backend. Check the Apps Script deployment URL."));
      script.src = cfg.API_URL + (cfg.API_URL.includes("?") ? "&" : "?") + query.toString();
      document.body.appendChild(script);
    });
  }
  function formatTime(seconds) { const s = Math.max(0, Math.floor(seconds || 0)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); }
  function message(id, value, error = false) { $(id).textContent = value || ""; $(id).style.color = error ? "#ff9c9c" : ""; }
  function setUnlocked(unlocked) { $("login-panel").classList.toggle("hidden", unlocked); $("admin-content").classList.toggle("hidden", !unlocked); }

  function render(state) {
    lastState = state;
    const current = state.current;
    $("current-song").textContent = current ? `${current.song} – ${current.artist}` : "Nothing is playing yet";
    $("current-requester").textContent = current ? `Requested by ${current.requester}` : "No active request";
    $("playback-state").textContent = state.paused ? "Paused" : (current ? "Playing" : "Waiting");
    countdownPaused = !!state.paused;
    countdownTarget = current && !countdownPaused ? Date.now() + Math.max(0, Number(state.remainingSeconds) || 0) * 1000 : null;
    $("countdown").textContent = current ? formatTime(state.remainingSeconds) : "—";
    $("countdown").classList.toggle("paused", countdownPaused);
    $("pause-button").textContent = state.paused ? "▶ Resume" : "Ⅱ Pause";
    $("back-button").disabled = !state.canGoBack;

    const list = $("queue-list"); list.replaceChildren();
    $("queue-count").textContent = `${state.queue.length} song${state.queue.length === 1 ? "" : "s"}`;
    if (!state.queue.length) { const li = document.createElement("li"); li.className = "empty"; li.textContent = "The queue is empty."; list.appendChild(li); return; }
    state.queue.forEach((item, index) => {
      const li = document.createElement("li"); li.className = "queue-item admin-queue-item";
      const num = document.createElement("span"); num.className = "queue-number"; num.textContent = String(index + 1).padStart(2, "0");
      const body = document.createElement("div"); body.className = "queue-item-body";
      const song = document.createElement("div"); song.className = "queue-song"; song.textContent = `${item.song} – ${item.artist}`;
      const requester = document.createElement("div"); requester.className = "queue-requester"; requester.textContent = `Requested by ${item.requester}`;
      body.append(song, requester);
      const actions = document.createElement("div"); actions.className = "queue-actions";
      const up = makeButton("↑", "Move up", () => queueAction("move", item.id, "up")); up.disabled = index === 0;
      const down = makeButton("↓", "Move down", () => queueAction("move", item.id, "down")); down.disabled = index === state.queue.length - 1;
      const remove = makeButton("×", "Remove song", () => queueAction("remove", item.id)); remove.classList.add("remove-button");
      actions.append(up, down, remove); li.append(num, body, actions); list.appendChild(li);
    });
  }
  function makeButton(label, title, handler) { const b = document.createElement("button"); b.type = "button"; b.className = "icon-button secondary"; b.textContent = label; b.title = title; b.setAttribute("aria-label", title); b.addEventListener("click", handler); return b; }
  async function refresh() { try { const result = await api("state"); render(result.state); } catch (e) { if (!lastState) message(ownerName ? "control-message" : "login-message", e.message, true); } }
  async function adminAction(action, params = {}) {
    if (busy) return; busy = true;
    try { await api(action, { ownerName, ...params }); await refresh(); message("control-message", action === "back" ? "Returned to the previous song." : action === "skip" ? "Moved to the next song." : action === "pause" ? "Playback paused." : action === "resume" ? "Playback resumed." : "Queue updated."); }
    catch (e) { message("control-message", e.message, true); }
    finally { busy = false; }
  }
  async function queueAction(action, songId, direction) {
    if (action === "remove" && !confirm("Remove this song from the queue?")) return;
    await adminAction(action, { songId, direction });
  }

  $("admin-login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const entered = $("owner-name").value.trim();
    if (entered.toLowerCase() !== OWNER_NAME.toLowerCase()) return message("login-message", "That owner name was not recognized.", true);
    try {
      await api("adminCheck", { ownerName: entered });
      ownerName = OWNER_NAME; sessionStorage.setItem(ADMIN_KEY, "1"); setUnlocked(true); message("control-message", "Host controls unlocked."); await refresh();
    } catch (e) { message("login-message", e.message, true); }
  });
  $("lock-button").addEventListener("click", () => { ownerName = ""; sessionStorage.removeItem(ADMIN_KEY); setUnlocked(false); $("owner-name").value = ""; message("login-message", "Host controls locked."); });
  $("back-button").addEventListener("click", () => adminAction("back"));
  $("forward-button").addEventListener("click", () => { if (confirm("Skip the current song and move forward?")) adminAction("skip"); });
  $("pause-button").addEventListener("click", () => adminAction(lastState?.paused ? "resume" : "pause"));

  setUnlocked(!!ownerName);
  setInterval(() => { if (countdownTarget !== null && !countdownPaused) $("countdown").textContent = formatTime(Math.max(0, Math.ceil((countdownTarget - Date.now()) / 1000))); }, 1000);
  refresh();
  setInterval(refresh, Math.max(5000, Number(cfg.REFRESH_MS) || 10000));
})();
