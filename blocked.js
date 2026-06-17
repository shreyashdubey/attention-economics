// Renders the blocked page. Reframes the intercept as a transaction the user
// is declining: the site is buying their attention, and the "harmless" minutes
// are shown compounded into their true lifetime price. Pulls real stats from
// storage so the screen argues with the user's own track record.

const params = new URLSearchParams(location.search);
const site = params.get("site");
const until = params.get("until");

// Short, dry, declarative lines — repeated exposure is the point. Sharpen the
// language here if you want it to bite harder.
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

// Consecutive days (ending today) Focus Guard intercepted at least one urge.
function computeStreak(byDay) {
  let streak = 0;
  const now = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const c = byDay[dateKey(d)] || 0;
    if (c > 0) streak++;
    else if (i === 0) continue; // today might just be early
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

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// --- static bits available immediately from the URL ----------------------

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
    chrome.runtime.openOptionsPage();
  });
}

// --- the price + the user's record ---------------------------------------

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

  // What one yes costs, then what a daily habit of it costs.
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

  // Track record — proof the user has refused before and can again.
  const refusedHere = site ? bySite[site] || 0 : 0;
  const totalIntercepts = Object.values(byDay).reduce((a, b) => a + b, 0);
  setText("siteCount", `${refusedHere}×`);
  setText("streak", String(computeStreak(byDay)));
  setText("reclaimed", fmtDuration(totalIntercepts * minutesPerBlock));
}

render();
