const DEFAULTS = {
  enabled: true,
  windows: [
    { start: "07:00", end: "21:00" },
    { start: "23:00", end: "06:00" },
  ],
  summaryTime: "21:00",
  minutesPerBlock: 12,
  sites: [
    "youtube.com",
    "netflix.com",
    "primevideo.com",
    "hotstar.com",
    "disneyplus.com",
    "hulu.com",
    "rainberrytv.com",
    "1337x.to",
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

const $ = (id) => document.getElementById(id);

function renderWindows(windows) {
  const host = $("windows");
  host.innerHTML = "";
  windows.forEach((w, i) => {
    const row = document.createElement("div");
    row.className = "win-row";
    row.innerHTML = `
      <input type="time" class="w-start" value="${w.start}" />
      <span class="to">to</span>
      <input type="time" class="w-end" value="${w.end}" />
      <button data-i="${i}" class="remove">Remove</button>`;
    host.appendChild(row);
  });
  host.querySelectorAll(".remove").forEach((btn) =>
    btn.addEventListener("click", () => {
      const wins = readWindows();
      wins.splice(Number(btn.dataset.i), 1);
      renderWindows(wins.length ? wins : [{ start: "07:00", end: "21:00" }]);
    })
  );
}

function readWindows() {
  const rows = [...document.querySelectorAll(".win-row")];
  return rows.map((r) => ({
    start: r.querySelector(".w-start").value || "07:00",
    end: r.querySelector(".w-end").value || "21:00",
  }));
}

function parseSites(text) {
  return text
    .split("\n")
    .map((l) =>
      l
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/.*$/, "")
    )
    .filter(Boolean);
}

async function load() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  $("enabled").checked = s.enabled;
  renderWindows(s.windows);
  $("summaryTime").value = s.summaryTime;
  $("minutesPerBlockNum").value = s.minutesPerBlock;
  $("sites").value = s.sites.join("\n");
}

async function save() {
  await chrome.storage.sync.set({
    enabled: $("enabled").checked,
    windows: readWindows(),
    summaryTime: $("summaryTime").value || "21:00",
    minutesPerBlock: Number($("minutesPerBlockNum").value) || 12,
    sites: parseSites($("sites").value),
  });
  const status = $("status");
  status.classList.add("show");
  setTimeout(() => status.classList.remove("show"), 1500);
}

// Master switch writes immediately. Turning OFF requires the arming sequence;
// turning ON is instant.
$("enabled").addEventListener("change", async (e) => {
  if (!e.target.checked) {
    const ok = await window.confirmPowerDown();
    if (!ok) {
      e.target.checked = true;
      return;
    }
  }
  await chrome.storage.sync.set({ enabled: e.target.checked });
});

$("addWindow").addEventListener("click", () => {
  renderWindows([...readWindows(), { start: "23:00", end: "06:00" }]);
});
$("save").addEventListener("click", save);
load();
