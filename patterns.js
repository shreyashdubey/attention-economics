// INTEL panel — surfaces what the tracker is learning and lets you adopt
// suggestions with one click. Reads local usage; nothing leaves the machine.

const P_DEFAULTS = {
  sites: [],
  ignoredSuggestions: [],
  autoBlockSuggestions: false,
  suggestThresholdMin: 60,
};

const PRODUCTIVITY = new Set([
  "google.com", "github.com", "gitlab.com", "stackoverflow.com", "localhost",
  "gmail.com", "docs.google.com", "drive.google.com", "calendar.google.com",
  "notion.so", "figma.com", "linear.app", "vercel.com", "cloudflare.com",
  "claude.ai", "claude.com", "chatgpt.com", "openai.com", "huggingface.co",
  "leetcode.com", "developer.mozilla.org", "npmjs.com", "stackblitz.com",
  "hostinger.com", "razorpay.com", "dbeaver.io", "groq.com", "cursor.com",
]);

function pDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}
function pLast7() {
  const out = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    out.push(pDateKey(d));
  }
  return out;
}
function pHostMatches(domain, site) {
  const s = site.toLowerCase().replace(/^www\./, "");
  return domain === s || domain.endsWith("." + s);
}

async function pRender() {
  const s = await chrome.storage.sync.get(P_DEFAULTS);
  const { usage = {} } = await chrome.storage.local.get("usage");

  document.getElementById("autoBlock").checked = !!s.autoBlockSuggestions;
  document.getElementById("suggestThreshold").value = s.suggestThresholdMin;

  const totals = {};
  for (const day of pLast7()) {
    const m = usage[day] || {};
    for (const [d, sec] of Object.entries(m)) totals[d] = (totals[d] || 0) + sec;
  }
  const tracked = Object.keys(totals).length;
  const ignored = new Set(s.ignoredSuggestions || []);
  const rows = Object.entries(totals)
    .filter(
      ([d]) =>
        !PRODUCTIVITY.has(d) &&
        !ignored.has(d) &&
        !s.sites.some((site) => pHostMatches(d, site))
    )
    .map(([d, sec]) => ({ domain: d, mins: sec / 60 }))
    .sort((a, b) => b.mins - a.mins)
    .slice(0, 8);

  const host = document.getElementById("patterns");
  if (!rows.length) {
    host.innerHTML = `<p class="pat-empty">${
      tracked
        ? "No new time-sinks above your threshold this week. Nice — the list is keeping up."
        : "Learning your patterns… browse normally and check back after a day. Active time is measured <b>locally only</b> and never leaves this machine."
    }</p>`;
    return;
  }

  const max = Math.max(...rows.map((r) => r.mins));
  const thr = s.suggestThresholdMin || 60;
  host.innerHTML =
    `<div class="pat-head te-label">candidate time-sinks — last 7 days (active time)</div>` +
    rows
      .map((r) => {
        const hrs = r.mins >= 60 ? (r.mins / 60).toFixed(1) + "h" : Math.round(r.mins) + "m";
        const sink = r.mins >= thr;
        return `<div class="pat-row">
          <span class="dom">${r.domain}</span>
          <span class="meter"><i style="width:${Math.max(4, (r.mins / max) * 100)}%"></i></span>
          <span class="hrs">${hrs}</span>
          ${sink ? '<span class="pat-tag sink">time-sink</span>' : ""}
          <span class="acts">
            <button class="pblock" data-d="${r.domain}">block</button>
            <button class="pdismiss" data-d="${r.domain}">dismiss</button>
          </span>
        </div>`;
      })
      .join("");

  host.querySelectorAll(".pblock").forEach((b) =>
    b.addEventListener("click", async () => {
      const d = b.dataset.d;
      const cur = await chrome.storage.sync.get({ sites: [] });
      if (!cur.sites.includes(d)) {
        await chrome.storage.sync.set({ sites: [...cur.sites, d] });
      }
      const ta = document.getElementById("sites");
      if (ta && !ta.value.split("\n").map((x) => x.trim()).includes(d)) {
        ta.value = (ta.value.trim() + "\n" + d).trim();
      }
      pRender();
    })
  );
  host.querySelectorAll(".pdismiss").forEach((b) =>
    b.addEventListener("click", async () => {
      const d = b.dataset.d;
      const cur = await chrome.storage.sync.get({ ignoredSuggestions: [] });
      if (!cur.ignoredSuggestions.includes(d)) {
        await chrome.storage.sync.set({
          ignoredSuggestions: [...cur.ignoredSuggestions, d],
        });
      }
      pRender();
    })
  );
}

document.getElementById("autoBlock").addEventListener("change", async (e) => {
  await chrome.storage.sync.set({ autoBlockSuggestions: e.target.checked });
});
document.getElementById("suggestThreshold").addEventListener("change", async (e) => {
  const v = Math.max(10, Math.min(600, Number(e.target.value) || 60));
  e.target.value = v;
  await chrome.storage.sync.set({ suggestThresholdMin: v });
});

pRender();
