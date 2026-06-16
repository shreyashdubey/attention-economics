// Focus Guard — service worker
// Blocks configured sites while the current local time is inside any block
// window, tracks intercepts per day, and sends a daily summary.

const DEFAULTS = {
  enabled: true,
  // One or more {start,end} windows in 24h "HH:MM" local time.
  // Overnight windows (start > end) are supported.
  windows: [
    { start: "07:00", end: "21:00" }, // work-hours focus
    { start: "23:00", end: "06:00" }, // protect sleep
  ],
  summaryTime: "21:00", // when the daily summary notification fires
  minutesPerBlock: 12, // estimate: minutes a single intercepted visit would cost
  sites: [
    // streaming / piracy
    "youtube.com",
    "netflix.com",
    "primevideo.com",
    "hotstar.com",
    "disneyplus.com",
    "hulu.com",
    "rainberrytv.com",
    "1337x.to",
    // your heavy distractions (from your history)
    "linkedin.com",
    "amazon.com",
    "myntra.com",
    "whatsapp.com",
    "x.com",
    "twitter.com",
    "instagram.com",
    "swiggy.com",
  ],
};

// ---- settings -----------------------------------------------------------

async function getSettings() {
  return chrome.storage.sync.get(DEFAULTS);
}

// ---- time helpers -------------------------------------------------------

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function windowActive(win, cur) {
  const start = toMinutes(win.start);
  const end = toMinutes(win.end);
  if (start === end) return false;
  if (start < end) return cur >= start && cur < end;
  return cur >= start || cur < end; // crosses midnight
}

// Returns the active window (so we can tell the user when it ends), or null.
function activeWindow(windows, now = new Date()) {
  const cur = now.getHours() * 60 + now.getMinutes();
  return windows.find((w) => windowActive(w, cur)) || null;
}

// ---- url matching -------------------------------------------------------

function hostMatchesSite(hostname, site) {
  const h = hostname.toLowerCase();
  const s = site.toLowerCase().replace(/^www\./, "");
  return h === s || h.endsWith("." + s);
}

function findBlockedSite(url, sites) {
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }
  return sites.find((site) => hostMatchesSite(hostname, site)) || null;
}

function isOwnPage(url) {
  return url.startsWith(chrome.runtime.getURL(""));
}

// ---- stats --------------------------------------------------------------

function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function recordIntercept(site) {
  const { stats = { byDay: {}, bySite: {} } } =
    await chrome.storage.local.get("stats");
  const key = todayKey();
  stats.byDay[key] = (stats.byDay[key] || 0) + 1;
  stats.bySite[site] = (stats.bySite[site] || 0) + 1;
  await chrome.storage.local.set({ stats });
}

// ---- blocking -----------------------------------------------------------

function blockedPageUrl(site, endTime, originalUrl) {
  const params = new URLSearchParams({
    site,
    until: endTime,
    from: originalUrl || "",
  });
  return chrome.runtime.getURL("blocked.html") + "?" + params.toString();
}

async function maybeBlock(tabId, url) {
  if (!url || isOwnPage(url)) return;

  const settings = await getSettings();
  if (!settings.enabled) return;

  const win = activeWindow(settings.windows);
  if (!win) return;

  const site = findBlockedSite(url, settings.sites);
  if (!site) return;

  await recordIntercept(site);
  await chrome.tabs.update(tabId, {
    url: blockedPageUrl(site, win.end, url),
  });
}

// ---- daily summary notification ----------------------------------------

async function showDailySummary() {
  const settings = await getSettings();
  const { stats = { byDay: {}, bySite: {} } } =
    await chrome.storage.local.get("stats");
  const count = stats.byDay[todayKey()] || 0;
  const mins = count * (settings.minutesPerBlock || 12);

  const lines =
    count === 0
      ? "No urges to intercept today — that's the goal. 🧘"
      : `Focus Guard stepped in ${count} time${count === 1 ? "" : "s"} today.\n` +
        `≈ ${mins} min reclaimed. Spend a little of it on something hard.`;

  chrome.notifications.create("daily-" + todayKey(), {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "Your focus, today",
    message: lines,
    priority: 1,
  });
}

function scheduleDailySummary(summaryTime) {
  const [h, m] = (summaryTime || "21:00").split(":").map(Number);
  const now = new Date();
  const next = new Date();
  next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  chrome.alarms.create("dailySummary", {
    when: next.getTime(),
    periodInMinutes: 1440,
  });
}

// ---- rescan open tabs ---------------------------------------------------

async function rescanAllTabs() {
  const settings = await getSettings();
  if (!settings.enabled) return;
  if (!activeWindow(settings.windows)) return;
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id != null && tab.url) maybeBlock(tab.id, tab.url);
  }
}

// ---- event wiring -------------------------------------------------------

chrome.webNavigation.onBeforeNavigate.addListener((d) => {
  if (d.frameId !== 0) return;
  maybeBlock(d.tabId, d.url);
});

chrome.webNavigation.onHistoryStateUpdated.addListener((d) => {
  if (d.frameId !== 0) return;
  maybeBlock(d.tabId, d.url);
});

async function init() {
  chrome.alarms.create("rescan", { periodInMinutes: 1 });
  const settings = await getSettings();
  scheduleDailySummary(settings.summaryTime);
  rescanAllTabs();
}

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "rescan") rescanAllTabs();
  if (alarm.name === "dailySummary") showDailySummary();
});

// Reschedule the summary if the user changes the time.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.summaryTime) {
    scheduleDailySummary(changes.summaryTime.newValue);
  }
});
