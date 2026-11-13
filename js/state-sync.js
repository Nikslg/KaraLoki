(() => {
  "use strict";
  // One completion-driven poll loop per page. It never starts a second timer tick
  // while the previous refresh is still running, and pauses while the tab is hidden.
  function start(refresh, intervalMs) {
    let timer = null, stopped = false, running = false;
    const interval = Math.max(5000, Number(intervalMs) || 5000);
    const clear = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };
    const schedule = (delay = interval) => {
      clear();
      if (stopped || document.hidden) return;
      timer = setTimeout(tick, delay);
    };
    async function tick() {
      if (stopped || document.hidden || running) return;
      running = true;
      try { await refresh(false); }
      catch (_) { /* Page-specific refresh handler owns user-facing errors. */ }
      finally { running = false; schedule(interval); }
    }
    function visibilityChanged() {
      if (document.hidden) clear();
      else schedule(0);
    }
    document.addEventListener("visibilitychange", visibilityChanged);
    schedule(interval);
    return () => { stopped = true; clear(); document.removeEventListener("visibilitychange", visibilityChanged); };
  }
  window.KaraLokiStateSync = Object.freeze({ start });
})();
