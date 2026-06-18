// Console overview of the break-glass budgets. Read-only: severity is learned
// automatically from usage + intercepts, so there's nothing to configure here —
// this just makes the math visible (which sites are "severe" and why).

(async function () {
  const host = document.getElementById("emergencyList");
  if (!host) return;

  // Meter fill represents how severe the addiction read is (not the budget).
  const tierFill = { severe: 100, moderate: 60, mild: 30 };

  let list = [];
  try {
    list = await chrome.runtime.sendMessage({ type: "emergencyOverview" });
  } catch (e) {
    return; // no extension context
  }
  if (!Array.isArray(list) || !list.length) {
    host.innerHTML = `<p class="pat-empty">No sites on the block list yet.</p>`;
    return;
  }

  host.innerHTML = "";
  for (const it of list) {
    const spent = it.usedToday >= it.maxPerDay;
    const row = document.createElement("div");
    row.className = "pat-row";
    row.innerHTML = `
      <span class="dom">${it.site}</span>
      <span class="em-tier em-${it.tier}">${it.tierLabel}</span>
      <span class="meter"><i style="width:${tierFill[it.tier] || 30}%"></i></span>
      <span class="hrs">${it.budgetMin}m</span>
      <span class="em-state${spent ? " spent" : ""}">${spent ? "spent" : "ready"}</span>`;
    host.appendChild(row);
  }
})();
