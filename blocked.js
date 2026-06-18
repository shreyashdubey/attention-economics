// Renders the blocked page. A mandatory pause sits up top: a hard countdown that
// re-engages reflective control before either escape — the schedule link or the
// metered break-glass — unlocks. A craving crests and fades; the delay outlasts it.
// Loss-aversion + anti-habituation copy below.

const params = new URLSearchParams(location.search);
const site = params.get("site");
const until = params.get("until");
const from = params.get("from");

const PAUSE_SEC = 12; // length of the mandatory pause before the escape hatches unlock

const CREEDS = [
  "It'll still be here later. The time won't.",
  "Cheap to make. Expensive to watch. Bad trade.",
  "Nothing here moves your life forward. You know that.",
  "An infinite feed built by a thousand people, aimed at one of you.",
  "Boredom is the price of focus. Pay it.",
  "The you that you're building doesn't spend time here.",
  "This was engineered to be hard to close. So close it.",
  "You don't owe this site your attention.",
];

const $ = (id) => document.getElementById(id);
function setText(id, v) { const el = $(id); if (el) el.textContent = v; }
function setHTML(id, v) { const el = $(id); if (el) el.innerHTML = v; }

function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function computeStreak(byDay) {
  let streak = 0;
  const now = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const c = byDay[dateKey(d)] || 0;
    if (c > 0) streak++;
    else if (i === 0) continue;
    else break;
  }
  return streak;
}
function fmtDuration(mins) {
  if (mins >= 60) { const h = mins / 60; return `${h % 1 === 0 ? h : h.toFixed(1)}h`; }
  return `${mins}m`;
}
function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function contextByHour(h) {
  if (h >= 5 && h < 9) return "early — the morning sets the whole day";
  if (h >= 9 && h < 12) return "prime deep-work hours";
  if (h >= 12 && h < 14) return "midday — don't hand the afternoon to a feed";
  if (h >= 14 && h < 17) return "the afternoon dip — a walk beats a scroll";
  if (h >= 17 && h < 21) return "evening — guard what's left of today";
  return "late — tired brain, weakest judgment, the classic trap";
}

// --- static bits ----------------------------------------------------------

if (site) setText("site", site);
if (until) {
  const [h, m] = until.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  setText("until", `${h12}:${String(m).padStart(2, "0")} ${period}`);
}
setText("creed", CREEDS[Math.floor(Math.random() * CREEDS.length)]);

const optionsLink = $("optionsLink");
if (optionsLink) {
  optionsLink.addEventListener("click", (e) => {
    e.preventDefault();
    if (optionsLink.classList.contains("locked")) return;
    chrome.runtime.openOptionsPage();
  });
}

let gateDone = false;
function unlockEscape() { if (optionsLink) optionsLink.classList.remove("locked"); }

// --- mandatory pause: hold the escape hatches until the countdown ends -----

function startTimerGate() {
  const t0 = performance.now();
  const fill = $("pauseFill");
  const numEl = $("count");
  const iv = setInterval(() => {
    if (gateDone) return clearInterval(iv);
    const ms = performance.now() - t0;
    const remain = Math.max(0, Math.ceil(PAUSE_SEC - ms / 1000));
    const frac = Math.min(1, ms / 1000 / PAUSE_SEC);
    setText("count", String(remain));
    if (fill) fill.style.width = frac * 100 + "%";
    setText("lockmsg", remain > 0 ? `unlocks in ${remain}s` : "");
    if (remain <= 0) {
      clearInterval(iv);
      gateDone = true;
      setText("count", "0");
      if (fill) fill.style.width = "100%";
      if (numEl) numEl.classList.add("done");
      setText("pauseLbl", "pause complete");
      setText("pauseUnit", "unlocked");
      setText("pauseSub", "the urge didn't get worse while you waited. it never does.");
      setText("lockmsg", "");
      unlockEscape();
      refreshEmergencyState(); // the break-glass control unlocks with the exit
    }
  }, 200);
}

// --- price, context, banked record ----------------------------------------

async function render() {
  let minutesPerBlock = 12;
  let byDay = {};
  let bySite = {};
  try {
    const sync = await chrome.storage.sync.get({ minutesPerBlock: 12 });
    const local = await chrome.storage.local.get({ stats: { byDay: {}, bySite: {} } });
    minutesPerBlock = sync.minutesPerBlock || 12;
    byDay = (local.stats && local.stats.byDay) || {};
    bySite = (local.stats && local.stats.bySite) || {};
  } catch (e) {
    /* preview / no extension context — defaults */
  }

  const yearlyHours = Math.round((minutesPerBlock * 365) / 60);
  const workDays = Math.max(1, Math.round(yearlyHours / 8));
  const decadeDays = Math.round((yearlyHours * 10) / 24);
  const decadeMonths = Math.round(decadeDays / 30.44);
  const decadeText =
    decadeDays < 24 ? `${decadeDays} days` : decadeMonths <= 1 ? "a month" : `${decadeMonths} months`;

  setText("now", `${minutesPerBlock} min`);
  setText("hero", String(yearlyHours));
  setText("priceFoot", `≈ ${workDays} full work-days a year · ${decadeText} of your life every decade`);

  const now = new Date();
  const hh = now.getHours();
  const timeStr = `${String(hh).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const todayCount = byDay[dateKey(now)] || 0;
  setHTML(
    "context",
    `<b>${timeStr}</b> · ${contextByHour(hh)} · this is your <b>${ordinal(Math.max(1, todayCount))}</b> intercept today`
  );

  const refusedHere = site ? bySite[site] || 0 : 0;
  const totalIntercepts = Object.values(byDay).reduce((a, b) => a + b, 0);
  const streak = computeStreak(byDay);
  const reclaimedStr = fmtDuration(totalIntercepts * minutesPerBlock);
  setText("siteCount", `${refusedHere}×`);
  setText("streak", String(streak));
  setText("reclaimed", reclaimedStr);
  setHTML(
    "bankedNote",
    `switching FG-1 off forfeits your <b>${streak}-day streak</b> and the <b>${reclaimedStr}</b> you've banked. that's the only way to lose it.`
  );
}

// --- emergency access ("break glass") --------------------------------------
// A metered pass for the rare genuine need. The budget is set by the service
// worker from how hard this site hits you (severe 10m / moderate 30m / mild 60m),
// and you get one per site per day. The control stays locked behind the gate.

let emergencyInfo = null;

function fmtMinsLeft(ms) {
  return Math.max(1, Math.ceil(ms / 60000)) + " min";
}

async function loadEmergency() {
  if (!site) return;
  try {
    emergencyInfo = await chrome.runtime.sendMessage({ type: "emergencyInfo", site });
  } catch (e) {
    return; // preview / no extension context
  }
  if (!emergencyInfo) return;
  setText("bgTier", `${emergencyInfo.tierLabel} · ${emergencyInfo.budgetMin} min`);
  setHTML(
    "bgDesc",
    `this site reads as <b>${emergencyInfo.tierLabel}</b> for you, so a pass is ` +
      `<b>${emergencyInfo.budgetMin} minutes</b> — your only one today. ` +
      `the clock starts the moment it opens and doesn't stop.`
  );
  refreshEmergencyState();
}

function refreshEmergencyState() {
  const box = $("breakglass");
  const btn = $("bgBtn");
  if (!box || !btn || !emergencyInfo) return;

  // A live pass or a spent daily allowance hard-locks the control, gate or not.
  if (emergencyInfo.activeUntil && Date.now() < emergencyInfo.activeUntil) {
    box.classList.add("locked");
    btn.disabled = true;
    btn.textContent = "access in progress";
    setText("bgFoot", `${site} is open — ${fmtMinsLeft(emergencyInfo.activeUntil - Date.now())} left`);
    return;
  }
  if (emergencyInfo.usedToday >= emergencyInfo.maxPerDay) {
    box.classList.add("locked");
    btn.disabled = true;
    btn.textContent = "pass spent for today";
    setText("bgFoot", "one break per site per day · resets tomorrow");
    return;
  }
  if (!gateDone) {
    box.classList.add("locked");
    btn.disabled = true;
    btn.textContent = "break glass";
    setText("bgFoot", "unlocks after the pause");
    return;
  }
  box.classList.remove("locked");
  btn.disabled = false;
  btn.textContent = "break glass";
  setText("bgFoot", `${emergencyInfo.budgetMin} min · counts as today's only pass`);
}

// Deliberate confirm: type an honest reason, then hold to commit. Resolves the
// reason string, or null if cancelled.
function showBreakGlassConfirm(info) {
  return new Promise((resolve) => {
    const HOLD_MS = 1500;
    const scrim = document.createElement("div");
    scrim.className = "arm-scrim";
    scrim.innerHTML = `
      <div class="te-plate arm-panel">
        <span class="te-screw tl"></span><span class="te-screw tr"></span>
        <span class="te-screw bl"></span><span class="te-screw br"></span>
        <div class="arm-head">
          <span class="te-model">FG&ndash;1</span>
          <span class="te-label">break glass</span>
        </div>
        <div class="te-screen arm-warn">
          <div class="arm-warn-title pix screen-orange">&#9888; ${info.budgetMin} minutes</div>
          <div class="arm-warn-body mono">
            unlocking <b>${info.site}</b> for <b>${info.budgetMin} min</b>.
            it&rsquo;s your <b>only</b> pass for it today, and the clock doesn&rsquo;t stop.
          </div>
        </div>
        <label class="bg-reason-l te-label">what do you genuinely need it for?</label>
        <textarea class="bg-reason" rows="2" maxlength="200" placeholder="be honest — you'll read this back"></textarea>
        <button class="arm-hold" type="button" disabled>
          <span class="arm-hold-fill"></span>
          <span class="arm-hold-txt">hold to break glass</span>
        </button>
        <button class="te-btn arm-cancel" type="button">cancel &mdash; stay blocked</button>
      </div>`;
    document.body.appendChild(scrim);

    const ta = scrim.querySelector(".bg-reason");
    const hold = scrim.querySelector(".arm-hold");
    const fill = scrim.querySelector(".arm-hold-fill");
    const txt = scrim.querySelector(".arm-hold-txt");
    const cancel = scrim.querySelector(".arm-cancel");
    let raf = null;
    let startT = 0;

    const ready = () => ta.value.trim().length >= 8;
    function stopHold() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      fill.style.width = "0%";
    }
    function syncReady() {
      const r = ready();
      hold.disabled = !r;
      hold.classList.toggle("ready", r);
      if (!r) stopHold();
    }
    function tick() {
      const t = (performance.now() - startT) / HOLD_MS;
      fill.style.width = Math.min(100, t * 100) + "%";
      if (t >= 1) return finish(ta.value.trim());
      raf = requestAnimationFrame(tick);
    }
    function startHold(e) {
      if (hold.disabled) return;
      e.preventDefault();
      txt.textContent = "breaking…";
      startT = performance.now();
      raf = requestAnimationFrame(tick);
    }
    function resetText() { if (!raf) txt.textContent = "hold to break glass"; }
    function teardown() { document.removeEventListener("keydown", onKey); scrim.remove(); }
    function finish(val) { teardown(); resolve(val); }
    function onKey(e) { if (e.key === "Escape") finish(null); }

    ta.addEventListener("input", syncReady);
    hold.addEventListener("pointerdown", startHold);
    hold.addEventListener("pointerup", () => { stopHold(); resetText(); });
    hold.addEventListener("pointerleave", () => { stopHold(); resetText(); });
    hold.addEventListener("pointercancel", () => { stopHold(); resetText(); });
    cancel.addEventListener("click", () => finish(null));
    scrim.addEventListener("mousedown", (e) => { if (e.target === scrim) finish(null); });
    document.addEventListener("keydown", onKey);
    syncReady();
    ta.focus();
  });
}

const bgBtn = $("bgBtn");
if (bgBtn) {
  bgBtn.addEventListener("click", async () => {
    if (bgBtn.disabled || !emergencyInfo || !emergencyInfo.allowed) return;
    const reason = await showBreakGlassConfirm(emergencyInfo);
    if (reason == null) return;
    let res = null;
    try {
      res = await chrome.runtime.sendMessage({ type: "grantEmergency", site, reason });
    } catch (e) {
      /* no context */
    }
    if (res && res.ok) {
      location.href = from || `https://${site}`;
    } else {
      // allowance changed under us (e.g. spent in another tab) — re-sync UI.
      if (res && res.info) emergencyInfo = res.info;
      refreshEmergencyState();
    }
  });
}

startTimerGate();
render();
loadEmergency();
