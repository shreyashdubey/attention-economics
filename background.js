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
  breathLock: false, // require one mic-validated breath to release the block-screen pause
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
  // ---- adaptive learning ----
  ignoredSuggestions: [], // domains you dismissed ("not a distraction")
  autoBlockSuggestions: false, // auto-add new time-sinks instead of asking
  suggestThresholdMin: 60, // a domain becomes a "time-sink" at this active min/week
};

// Never suggest/auto-block these — they're how you do the work.
const PRODUCTIVITY = new Set([
  "google.com", "github.com", "gitlab.com", "stackoverflow.com", "localhost",
  "gmail.com", "docs.google.com", "drive.google.com", "calendar.google.com",
  "notion.so", "figma.com", "linear.app", "vercel.com", "cloudflare.com",
  "claude.ai", "claude.com", "chatgpt.com", "openai.com", "huggingface.co",
  "leetcode.com", "developer.mozilla.org", "npmjs.com", "stackblitz.com",
  "hostinger.com", "razorpay.com", "dbeaver.io", "groq.com", "cursor.com",
]);

// ---- settings -----------------------------------------------------------

async function getSettings() {
  return chrome.storage.sync.get(DEFAULTS);
}

// Reduce a hostname to its registrable-ish domain (m.youtube.com -> youtube.com).
const MULTI_SLD = new Set(["co", "com", "org", "net", "gov", "edu", "ac"]);
function regDomain(hostname) {
  if (!hostname) return null;
  let h = hostname.toLowerCase().replace(/^www\./, "");
  const parts = h.split(".");
  if (parts.length <= 2) return h;
  if (MULTI_SLD.has(parts[parts.length - 2])) return parts.slice(-3).join(".");
  return parts.slice(-2).join(".");
}

function domainOfUrl(url) {
  if (!url) return null;
  if (/^(chrome|chrome-extension|edge|about|devtools):/i.test(url)) return null;
  try {
    return regDomain(new URL(url).hostname);
  } catch {
    return null;
  }
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

// ---- adaptive usage tracking --------------------------------------------
// Measures *active* foreground seconds per domain per day, idle-aware, stored
// locally only. This is the signal that lets the block list keep up with you.

const MAX_TICK_SEC = 75; // clamp a single attribution (covers SW sleep / jitter)
const USAGE_RETENTION_DAYS = 30;

function pruneUsage(usage) {
  const keep = new Set();
  const now = new Date();
  for (let i = 0; i < USAGE_RETENTION_DAYS; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    keep.add(todayKey(d));
  }
  for (const day of Object.keys(usage)) if (!keep.has(day)) delete usage[day];
  return usage;
}

async function flushActive(clear = false) {
  const now = Date.now();
  const { activeState } = await chrome.storage.local.get("activeState");
  const st = activeState || { domain: null, since: 0 };
  if (st.domain && st.since) {
    const secs = Math.max(0, Math.min(MAX_TICK_SEC, (now - st.since) / 1000));
    if (secs >= 1) {
      const { usage = {} } = await chrome.storage.local.get("usage");
      const day = todayKey();
      usage[day] = usage[day] || {};
      usage[day][st.domain] = (usage[day][st.domain] || 0) + secs;
      pruneUsage(usage);
      await chrome.storage.local.set({ usage });
    }
  }
  await chrome.storage.local.set({
    activeState: clear
      ? { domain: null, since: 0 }
      : { domain: st.domain, since: now },
  });
}

async function setActiveDomain(domain) {
  await flushActive(true); // bank time for the previous domain
  await chrome.storage.local.set({
    activeState: { domain: domain || null, since: domain ? Date.now() : 0 },
  });
}

async function focusedDomain() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab ? domainOfUrl(tab.url) : null;
  } catch {
    return null;
  }
}

// Called every minute (rolling) and on focus/idle events.
async function usageTick() {
  let state = "active";
  try {
    state = await chrome.idle.queryState(60);
  } catch {}
  if (state !== "active") return flushActive(true);
  const d = await focusedDomain();
  if (!d) return flushActive(true);
  const { activeState } = await chrome.storage.local.get("activeState");
  if (!activeState || activeState.domain !== d) await setActiveDomain(d);
  else await flushActive(false); // rolling flush, same domain
}

// ---- suggestion engine --------------------------------------------------

function last7Keys() {
  const out = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    out.push(todayKey(d));
  }
  return out;
}

function isBlocked(domain, sites) {
  return sites.some((site) => hostMatchesSite(domain, site));
}

// Returns non-blocked, non-productivity domains over the weekly threshold.
async function computeSuggestions() {
  const settings = await getSettings();
  const { usage = {} } = await chrome.storage.local.get("usage");
  const ignored = new Set(settings.ignoredSuggestions || []);
  const thresholdSec = (settings.suggestThresholdMin || 60) * 60;

  const totals = {};
  for (const day of last7Keys()) {
    const m = usage[day] || {};
    for (const [d, s] of Object.entries(m)) totals[d] = (totals[d] || 0) + s;
  }

  const out = [];
  for (const [d, s] of Object.entries(totals)) {
    if (PRODUCTIVITY.has(d) || ignored.has(d)) continue;
    if (isBlocked(d, settings.sites)) continue;
    if (s >= thresholdSec) out.push({ domain: d, seconds: s });
  }
  return out.sort((a, b) => b.seconds - a.seconds);
}

async function addSiteToBlocklist(domain) {
  const settings = await getSettings();
  if (!settings.sites.includes(domain)) {
    await chrome.storage.sync.set({ sites: [...settings.sites, domain] });
  }
}

// Runs once a day: auto-block (if opted in) or notify with one-tap actions.
async function checkAndSuggest() {
  const settings = await getSettings();
  const suggestions = await computeSuggestions();
  if (!suggestions.length) return;

  if (settings.autoBlockSuggestions) {
    const added = suggestions.map((s) => s.domain);
    for (const d of added) await addSiteToBlocklist(d);
    chrome.notifications.create("autoblock-" + todayKey(), {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Block list updated automatically",
      message: `New time-sinks blocked: ${added.slice(0, 4).join(", ")}${
        added.length > 4 ? "…" : ""
      }`,
      priority: 2,
    });
    return;
  }

  const { alerted = [] } = await chrome.storage.local.get("alerted");
  const target = suggestions.find((s) => !alerted.includes(s.domain));
  if (!target) return;
  const hrs = (target.seconds / 3600).toFixed(1);
  chrome.notifications.create("suggest::" + target.domain, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "New time-sink detected",
    message: `${target.domain} took ${hrs}h of active time this week. Add it to the block list?`,
    buttons: [{ title: "Block it" }, { title: "Not a distraction" }],
    priority: 2,
  });
  await chrome.storage.local.set({ alerted: [...alerted, target.domain] });
}

chrome.notifications.onButtonClicked.addListener(async (id, idx) => {
  if (!id.startsWith("suggest::")) return;
  const domain = id.slice("suggest::".length);
  if (idx === 0) {
    await addSiteToBlocklist(domain);
  } else {
    const settings = await getSettings();
    const ig = settings.ignoredSuggestions || [];
    if (!ig.includes(domain)) {
      await chrome.storage.sync.set({ ignoredSuggestions: [...ig, domain] });
    }
  }
  chrome.notifications.clear(id);
});

// ---- event wiring -------------------------------------------------------

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await setActiveDomain(domainOfUrl(tab.url));
  } catch {}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.active) setActiveDomain(domainOfUrl(changeInfo.url));
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return flushActive(true);
  await setActiveDomain(await focusedDomain());
});

chrome.idle.onStateChanged.addListener(async (state) => {
  if (state === "active") await setActiveDomain(await focusedDomain());
  else await flushActive(true);
});

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
  try {
    chrome.idle.setDetectionInterval(60);
  } catch {}
  const settings = await getSettings();
  scheduleDailySummary(settings.summaryTime);
  rescanAllTabs();
}

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "rescan") {
    rescanAllTabs();
    usageTick();
  }
  if (alarm.name === "dailySummary") {
    showDailySummary();
    checkAndSuggest();
  }
});

// Reschedule the summary if the user changes the time.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.summaryTime) {
    scheduleDailySummary(changes.summaryTime.newValue);
  }
});
