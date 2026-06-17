// Renders the blocked page. Built on in-the-moment behavioural mechanisms:
//  - urge-surf pause: a craving crests and fades; a forced delay re-engages
//    reflective control and gates the only real escape hatch (turning the
//    guard off) until the wave has passed.
//  - loss aversion / endowment: streak + reclaimed time are framed as banked
//    and forfeited only by quitting.
//  - anti-habituation: time-of-day + visit-count context and a rotating line
//    keep the screen from going invisible; a fixed anchor line is repeated
//    every block for fluency.

const params = new URLSearchParams(location.search);
const site = params.get("site");
const until = params.get("until");

const PAUSE_SEC = 12; // urge-surf gate before the escape hatch unlocks

// Rotating second line — dry and blunt. Sharpen here if you want it to bite.
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
  if (mins >= 60) {
    const h = mins / 60;
    return `${h % 1 === 0 ? h : h.toFixed(1)}h`;
  }
  return `${mins}m`;
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Anti-habituation: name the moment so the screen stays specific, not generic.
function contextByHour(h) {
  if (h >= 5 && h < 9) return "early — the morning sets the whole day";
  if (h >= 9 && h < 12) return "prime deep-work hours";
  if (h >= 12 && h < 14) return "midday — don't hand the afternoon to a feed";
  if (h >= 14 && h < 17) return "the afternoon dip — a walk beats a scroll";
  if (h >= 17 && h < 21) return "evening — guard what's left of today";
  return "late — tired brain, weakest judgment, the classic trap";
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}
function setHTML(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = value;
}

// --- static bits available immediately ----------------------------------

if (site) setText("site", site);

if (until) {
  const [h, m] = until.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  setText("until", `${h12}:${String(m).padStart(2, "0")} ${period}`);
}

setText("creed", CREEDS[Math.floor(Math.random() * CREEDS.length)]);

const optionsLink = document.getElementById("optionsLink");
if (optionsLink) {
  optionsLink.addEventListener("click", (e) => {
    e.preventDefault();
    if (optionsLink.classList.contains("locked")) return;
    chrome.runtime.openOptionsPage();
  });
}

// --- urge-surf gate: hold the escape hatch until the wave passes ----------

function startGate() {
  const phaseEl = document.getElementById("phase");
  const countEl = document.getElementById("count");
  const lockEl = document.getElementById("lockmsg");
  const subEl = document.getElementById("surfSub");
  const t0 = performance.now();

  // breathing cycle: inhale 0–4s · hold 4–5s · exhale 5–10s (matches CSS orb)
  function phaseFor(ms) {
    const p = ms % 10000;
    if (p < 4000) return "breathe in";
    if (p < 5000) return "hold";
    return "breathe out";
  }

  const iv = setInterval(() => {
    const ms = performance.now() - t0;
    const remain = Math.max(0, Math.ceil(PAUSE_SEC - ms / 1000));
    if (phaseEl) phaseEl.textContent = phaseFor(ms);
    if (countEl) countEl.textContent = remain;
    if (lockEl) lockEl.textContent = remain > 0 ? `unlocks in ${remain}s` : "";
    if (remain <= 0) {
      clearInterval(iv);
      if (phaseEl) phaseEl.textContent = "the wave passed";
      if (subEl)
        subEl.textContent =
          "nothing here got better while you waited. it never does.";
      if (optionsLink) optionsLink.classList.remove("locked");
    }
  }, 200);
}

// --- the price, the context line, and the banked record ------------------

async function render() {
  let minutesPerBlock = 12;
  let byDay = {};
  let bySite = {};
  try {
    const sync = await chrome.storage.sync.get({ minutesPerBlock: 12 });
    const local = await chrome.storage.local.get({
      stats: { byDay: {}, bySite: {} },
    });
    minutesPerBlock = sync.minutesPerBlock || 12;
    byDay = (local.stats && local.stats.byDay) || {};
    bySite = (local.stats && local.stats.bySite) || {};
  } catch (e) {
    /* preview / no extension context — fall back to defaults */
  }

  // What one yes costs, compounded into a daily habit.
  const yearlyHours = Math.round((minutesPerBlock * 365) / 60);
  const workDays = Math.max(1, Math.round(yearlyHours / 8));
  const decadeDays = Math.round((yearlyHours * 10) / 24);
  const decadeMonths = Math.round(decadeDays / 30.44);
  const decadeText =
    decadeDays < 24
      ? `${decadeDays} days`
      : decadeMonths <= 1
      ? "a month"
      : `${decadeMonths} months`;

  setText("now", `${minutesPerBlock} min`);
  setText("hero", String(yearlyHours));
  setText(
    "priceFoot",
    `≈ ${workDays} full work-days a year · ${decadeText} of your life every decade`
  );

  // Context line — anti-habituation.
  const now = new Date();
  const hh = now.getHours();
  const timeStr = `${String(hh).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}`;
  const todayCount = byDay[dateKey(now)] || 0;
  setHTML(
    "context",
    `<b>${timeStr}</b> · ${contextByHour(hh)} · this is your <b>${ordinal(
      Math.max(1, todayCount)
    )}</b> intercept today`
  );

  // Banked record — loss aversion: yours, forfeited only by quitting.
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

startGate();
render();
