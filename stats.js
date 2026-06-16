function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function lastNDays(n) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    out.push(d);
  }
  return out;
}

// Streak = consecutive days (ending today) the extension intercepted at least
// one urge — i.e. days you were tempted and Focus Guard held the line.
function computeStreak(byDay) {
  let streak = 0;
  const now = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const c = byDay[dateKey(d)] || 0;
    if (c > 0) streak++;
    else if (i === 0) continue; // today might just be early — don't break on day 0
    else break;
  }
  return streak;
}

async function render() {
  const { stats = { byDay: {}, bySite: {} } } =
    await chrome.storage.local.get("stats");
  const { minutesPerBlock = 12 } = await chrome.storage.sync.get("minutesPerBlock");
  const byDay = stats.byDay || {};

  const todayCount = byDay[dateKey(new Date())] || 0;
  const total = Object.values(byDay).reduce((a, b) => a + b, 0);

  document.getElementById("today").textContent = todayCount;
  document.getElementById("streak").textContent = computeStreak(byDay);
  const mins = total * minutesPerBlock;
  document.getElementById("reclaimed").textContent =
    mins >= 60 ? `${(mins / 60).toFixed(1)}h` : `${mins}m`;

  const days = lastNDays(7);
  const counts = days.map((d) => byDay[dateKey(d)] || 0);
  const max = Math.max(1, ...counts);
  const chart = document.getElementById("chart");
  chart.innerHTML = "";
  const labels = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  days.forEach((d, i) => {
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.innerHTML = `
      <div class="v">${counts[i] || ""}</div>
      <div class="fill" style="height:${(counts[i] / max) * 100}%"></div>
      <div class="d">${labels[d.getDay()]}</div>`;
    chart.appendChild(bar);
  });

  const encourage =
    `Each bar is a moment you reached for an old habit and the wall held. ` +
    `That repetition — not any single day — is what actually rewires the loop over weeks. ` +
    `No tool can measure your brain directly, so this counts the honest proxy: urges intercepted. ` +
    `Pair it with one hard thing a day (read 10 pages, ship one commit, write 200 words) and the count below ` +
    `becomes momentum instead of just restriction.`;
  document.getElementById("encourage").textContent = encourage;
}

render();
