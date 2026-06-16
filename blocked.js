// Renders the blocked page using query params passed by the service worker.
const params = new URLSearchParams(location.search);
const site = params.get("site");
const until = params.get("until");

if (site) {
  document.getElementById("site").textContent = site;
}

if (until) {
  // until is "HH:MM" 24h — show a friendly 12h version.
  const [h, m] = until.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  const friendly = `${h12}:${String(m).padStart(2, "0")} ${period}`;
  document.getElementById("until").textContent = `Available again at ${friendly}`;
}

document.getElementById("optionsLink").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
