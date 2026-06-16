const DEFAULTS = {
  enabled: true,
  windows: [
    { start: "07:00", end: "21:00" },
    { start: "23:00", end: "06:00" },
  ],
};

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function activeWindow(windows) {
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  return (
    windows.find((w) => {
      const s = toMinutes(w.start);
      const e = toMinutes(w.end);
      if (s === e) return false;
      return s < e ? cur >= s && cur < e : cur >= s || cur < e;
    }) || null
  );
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

async function render() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  document.getElementById("enabled").checked = s.enabled;

  const stateEl = document.getElementById("state");
  if (!s.enabled) {
    stateEl.innerHTML = `Blocking is <span class="badge off">off</span>.`;
  } else {
    const win = activeWindow(s.windows);
    stateEl.innerHTML = win
      ? `Currently <span class="badge on">blocking</span> until ${win.end}.`
      : `Idle. Blocking resumes in your next window.`;
  }

  const { stats = { byDay: {} } } = await chrome.storage.local.get("stats");
  const c = stats.byDay[todayKey()] || 0;
  document.getElementById("today").innerHTML = `Today: <b>${c}</b> urge${
    c === 1 ? "" : "s"
  } intercepted.`;
}

document.getElementById("enabled").addEventListener("change", async (e) => {
  await chrome.storage.sync.set({ enabled: e.target.checked });
  render();
});
document.getElementById("options").addEventListener("click", () =>
  chrome.runtime.openOptionsPage()
);
document.getElementById("stats").addEventListener("click", () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("stats.html") })
);

render();
