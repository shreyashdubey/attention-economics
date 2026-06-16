// Power-down arming sequence — deliberate friction before blocking can be
// disabled. Exposes window.confirmPowerDown() -> Promise<boolean>.
// Turning the master switch OFF is hard (flip 3 safety switches + hold 3s);
// turning it back ON stays instant (callers only invoke this on OFF attempts).

(function () {
  const HOLD_MS = 3000;

  function dateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function computeStreak(byDay) {
    let s = 0;
    const now = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const c = byDay[dateKey(d)] || 0;
      if (c > 0) s++;
      else if (i === 0) continue;
      else break;
    }
    return s;
  }

  async function gatherContext() {
    let siteCount = 0,
      streak = 0;
    try {
      const sync = await chrome.storage.sync.get({ sites: [] });
      const local = await chrome.storage.local.get({ stats: { byDay: {} } });
      siteCount = (sync.sites || []).length;
      streak = computeStreak((local.stats && local.stats.byDay) || {});
    } catch (e) {
      /* preview / no extension context */
    }
    return { siteCount, streak };
  }

  window.confirmPowerDown = async function () {
    const { siteCount, streak } = await gatherContext();

    return new Promise((resolve) => {
      const scrim = document.createElement("div");
      scrim.className = "arm-scrim";
      scrim.innerHTML = `
        <div class="te-plate arm-panel">
          <span class="te-screw tl"></span><span class="te-screw tr"></span>
          <span class="te-screw bl"></span><span class="te-screw br"></span>
          <div class="arm-head">
            <span class="te-model">FG&ndash;1</span>
            <span class="te-label">power-down sequence</span>
          </div>
          <div class="te-screen arm-warn">
            <div class="arm-warn-title pix screen-orange">&#9888; disarm?</div>
            <div class="arm-warn-body mono">
              powering down unblocks <b>${siteCount}</b> sites.
              your <b>${streak}-day</b> streak holds only while this stays on.
            </div>
          </div>
          <span class="arm-label te-label">flip all 3 safety switches to arm</span>
          <div class="arm-switches">
            <label class="arm-row"><span>this unblocks ${siteCount} sites</span><input type="checkbox" class="te-switch arm-sw" /></label>
            <label class="arm-row"><span>streak protection stops</span><input type="checkbox" class="te-switch arm-sw" /></label>
            <label class="arm-row"><span>i'm choosing distraction on purpose</span><input type="checkbox" class="te-switch arm-sw" /></label>
          </div>
          <button class="arm-hold" type="button" disabled>
            <span class="arm-hold-fill"></span>
            <span class="arm-hold-txt">hold 3s to power down</span>
          </button>
          <button class="te-btn arm-cancel" type="button">cancel &mdash; stay focused</button>
        </div>`;
      document.body.appendChild(scrim);

      const sws = [...scrim.querySelectorAll(".arm-sw")];
      const hold = scrim.querySelector(".arm-hold");
      const fill = scrim.querySelector(".arm-hold-fill");
      const txt = scrim.querySelector(".arm-hold-txt");
      const cancel = scrim.querySelector(".arm-cancel");
      let raf = null;
      let startT = 0;

      const allArmed = () => sws.every((s) => s.checked);

      function stopHold() {
        if (raf) cancelAnimationFrame(raf);
        raf = null;
        fill.style.width = "0%";
      }

      function syncArm() {
        const a = allArmed();
        hold.disabled = !a;
        hold.classList.toggle("ready", a);
        if (!a) stopHold();
      }

      function tick() {
        const t = (performance.now() - startT) / HOLD_MS;
        fill.style.width = Math.min(100, t * 100) + "%";
        if (t >= 1) {
          finish(true);
          return;
        }
        raf = requestAnimationFrame(tick);
      }

      function startHold(e) {
        if (hold.disabled) return;
        e.preventDefault();
        txt.textContent = "powering down…";
        startT = performance.now();
        raf = requestAnimationFrame(tick);
      }

      function resetText() {
        if (!raf) txt.textContent = "hold 3s to power down";
      }

      function teardown() {
        document.removeEventListener("keydown", onKey);
        scrim.remove();
      }
      function finish(ok) {
        teardown();
        resolve(ok);
      }
      function onKey(e) {
        if (e.key === "Escape") finish(false);
      }

      sws.forEach((s) => s.addEventListener("change", syncArm));
      hold.addEventListener("pointerdown", startHold);
      hold.addEventListener("pointerup", () => {
        stopHold();
        resetText();
      });
      hold.addEventListener("pointerleave", () => {
        stopHold();
        resetText();
      });
      hold.addEventListener("pointercancel", () => {
        stopHold();
        resetText();
      });
      cancel.addEventListener("click", () => finish(false));
      scrim.addEventListener("mousedown", (e) => {
        if (e.target === scrim) finish(false);
      });
      document.addEventListener("keydown", onKey);

      syncArm();
    });
  };
})();
