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

// ---- emergency access ("break glass") -----------------------------------
// A metered escape hatch. When you genuinely need a blocked site you can unlock
// it for a fixed budget — but the budget SHRINKS the more addicted you are to
// that specific site, and you get exactly one pass per site per day. Severity is
// derived automatically from how much you reach for the site (see emergencyScore).
const EMERGENCY = {
  maxPerSitePerDay: 1,
  // Tiers are checked high → low; the first whose minScore you clear wins.
  // minScore is in weekly "minute-equivalents": active minutes you spent on the
  // site + minutesPerBlock charged for every intercept the guard had to make.
  tiers: [
    { id: "severe", label: "severe", minScore: 300, budgetMin: 10 },
    { id: "moderate", label: "moderate", minScore: 90, budgetMin: 30 },
    { id: "mild", label: "mild", minScore: 0, budgetMin: 60 },
  ],
};

function severityFor(score) {
  return (
    EMERGENCY.tiers.find((t) => score >= t.minScore) ||
    EMERGENCY.tiers[EMERGENCY.tiers.length - 1]
  );
}

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

// Day-keys for the last n days, used to prune day-keyed maps.
function keepDays(n) {
  const keep = new Set();
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    keep.add(todayKey(d));
  }
  return keep;
}

function pruneDayMap(map, days) {
  const keep = keepDays(days);
  for (const k of Object.keys(map)) if (!keep.has(k)) delete map[k];
  return map;
}

async function recordIntercept(site) {
  const { stats = { byDay: {}, bySite: {}, bySiteDay: {} } } =
    await chrome.storage.local.get("stats");
  const key = todayKey();
  stats.byDay[key] = (stats.byDay[key] || 0) + 1;
  stats.bySite[site] = (stats.bySite[site] || 0) + 1;
  // per-site-per-day intercepts feed the emergency severity score below.
  stats.bySiteDay = stats.bySiteDay || {};
  stats.bySiteDay[key] = stats.bySiteDay[key] || {};
  stats.bySiteDay[key][site] = (stats.bySiteDay[key][site] || 0) + 1;
  pruneDayMap(stats.bySiteDay, USAGE_RETENTION_DAYS);
  await chrome.storage.local.set({ stats });
}

// ---- emergency access: scoring, passes, budget --------------------------

// A site's weekly "addiction score" = active minutes you actually spent on it +
// a minutesPerBlock charge for every time the guard had to intercept it. Both
// signals are already tracked. Pairing them matters: a blocked site accrues
// almost no direct usage, so the intercept count carries the signal instead.
async function emergencyScore(site) {
  const settings = await getSettings();
  const { usage = {} } = await chrome.storage.local.get("usage");
  const { stats = {} } = await chrome.storage.local.get("stats");
  const bySiteDay = stats.bySiteDay || {};
  const perBlock = settings.minutesPerBlock || 12;

  let activeSec = 0;
  let intercepts = 0;
  for (const day of last7Keys()) {
    const u = usage[day] || {};
    for (const [d, s] of Object.entries(u)) {
      if (d === site || hostMatchesSite(d, site)) activeSec += s;
    }
    intercepts += (bySiteDay[day] || {})[site] || 0;
  }
  return Math.round(activeSec / 60 + perBlock * intercepts);
}

// Returns the live pass for a site, or null. Self-heals an expired one.
async function activePass(site) {
  const { emergencyPasses = {} } = await chrome.storage.local.get("emergencyPasses");
  const p = emergencyPasses[site];
  if (p && Date.now() < p.expiresAt) return p;
  if (p) {
    delete emergencyPasses[site];
    await chrome.storage.local.set({ emergencyPasses });
  }
  return null;
}

async function emergencyUsedToday(site) {
  const { emergencyUses = {} } = await chrome.storage.local.get("emergencyUses");
  return (emergencyUses[todayKey()] || {})[site] || 0;
}

// Everything the blocked page / console need to render the break-glass control.
async function getEmergencyInfo(site) {
  const score = await emergencyScore(site);
  const tier = severityFor(score);
  const usedToday = await emergencyUsedToday(site);
  const pass = await activePass(site);
  return {
    site,
    tier: tier.id,
    tierLabel: tier.label,
    budgetMin: tier.budgetMin,
    usedToday,
    maxPerDay: EMERGENCY.maxPerSitePerDay,
    activeUntil: pass ? pass.expiresAt : null,
    allowed: !pass && usedToday < EMERGENCY.maxPerSitePerDay,
    score,
  };
}

async function grantEmergency(site, reason) {
  const info = await getEmergencyInfo(site);
  if (!info.allowed) {
    return { ok: false, reason: info.activeUntil ? "active" : "cap", info };
  }
  const now = Date.now();
  const expiresAt = now + info.budgetMin * 60000;

  const { emergencyPasses = {} } = await chrome.storage.local.get("emergencyPasses");
  emergencyPasses[site] = {
    expiresAt,
    grantedAt: now,
    budgetMin: info.budgetMin,
    tier: info.tier,
    reason: String(reason || "").slice(0, 200),
  };
  await chrome.storage.local.set({ emergencyPasses });

  const { emergencyUses = {} } = await chrome.storage.local.get("emergencyUses");
  const key = todayKey();
  emergencyUses[key] = emergencyUses[key] || {};
  emergencyUses[key][site] = (emergencyUses[key][site] || 0) + 1;
  pruneDayMap(emergencyUses, USAGE_RETENTION_DAYS);
  await chrome.storage.local.set({ emergencyUses });

  chrome.alarms.create("emergend::" + site, { when: expiresAt });
  await updateBadge();
  return { ok: true, expiresAt, budgetMin: info.budgetMin, tier: info.tier };
}

// Pass elapsed: drop it, re-block any tab still parked on the site, notify once.
async function endEmergency(site) {
  const { emergencyPasses = {} } = await chrome.storage.local.get("emergencyPasses");
  const had = !!emergencyPasses[site];
  if (had) {
    delete emergencyPasses[site];
    await chrome.storage.local.set({ emergencyPasses });
  }
  await updateBadge();

  const settings = await getSettings();
  if (settings.enabled && activeWindow(settings.windows)) {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (
        tab.id != null &&
        tab.url &&
        findBlockedSite(tab.url, settings.sites) === site
      ) {
        maybeBlock(tab.id, tab.url);
      }
    }
  }
  if (had) {
    chrome.notifications.create("emerg-end::" + site + "::" + todayKey(), {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Emergency time's up",
      message: `${site} is locked again. That was your one pass for today — back to it.`,
      priority: 2,
    });
  }
}

// Toolbar badge shows whole minutes left on the soonest-expiring pass.
async function updateBadge() {
  const { emergencyPasses = {} } = await chrome.storage.local.get("emergencyPasses");
  const now = Date.now();
  let soonest = null;
  let changed = false;
  for (const [site, p] of Object.entries(emergencyPasses)) {
    if (now < p.expiresAt) {
      if (soonest == null || p.expiresAt < soonest) soonest = p.expiresAt;
    } else {
      delete emergencyPasses[site];
      changed = true;
    }
  }
  if (changed) await chrome.storage.local.set({ emergencyPasses });
  try {
    if (soonest == null) {
      await chrome.action.setBadgeText({ text: "" });
    } else {
      const minLeft = Math.max(1, Math.ceil((soonest - now) / 60000));
      await chrome.action.setBadgeBackgroundColor({ color: "#fe5000" });
      await chrome.action.setBadgeText({ text: String(minLeft) });
    }
  } catch (e) {
    /* action API unavailable */
  }
}

// All blocked sites with their current tier/budget — for the console overview.
async function emergencyOverview() {
  const settings = await getSettings();
  const out = [];
  for (const site of settings.sites) out.push(await getEmergencyInfo(site));
  const rank = { severe: 0, moderate: 1, mild: 2 };
  out.sort((a, b) => rank[a.tier] - rank[b.tier] || b.score - a.score);
  return out;
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

  // An active break-glass pass lets the site through until it expires.
  if (await activePass(site)) return;

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

// ---- messages from blocked page / console -------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return;
  if (msg.type === "emergencyInfo") {
    getEmergencyInfo(msg.site).then(sendResponse);
    return true; // async response
  }
  if (msg.type === "grantEmergency") {
    grantEmergency(msg.site, msg.reason).then(sendResponse);
    return true;
  }
  if (msg.type === "emergencyOverview") {
    emergencyOverview().then(sendResponse);
    return true;
  }
});

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
  updateBadge();
}

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "rescan") {
    rescanAllTabs();
    usageTick();
    updateBadge(); // keeps the break-glass countdown ticking down
  }
  if (alarm.name === "dailySummary") {
    showDailySummary();
    checkAndSuggest();
  }
  if (alarm.name.startsWith("emergend::")) {
    endEmergency(alarm.name.slice("emergend::".length));
  }
});

// Reschedule the summary if the user changes the time.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.summaryTime) {
    scheduleDailySummary(changes.summaryTime.newValue);
  }
});
