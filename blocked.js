// Renders the blocked page. The urge-surf gate is a live breathing tutor:
//  - it LISTENS and reacts to your actual breath (not a metronome): it detects
//    the inhale onset, the silent hold, and the exhale — timing each phase —
//    then scores the breath. A craving crests and fades; doing one slow,
//    exhale-led breath flips the parasympathetic switch and the urge loosens.
//  - audio is processed on-device only; nothing is recorded or sent, and the
//    mic track stops the instant the breath completes.
//  - a safety timer always releases the gate; the escape hatch (turning the
//    guard off) stays locked until then. Loss/anti-habituation copy below.

const params = new URLSearchParams(location.search);
const site = params.get("site");
const until = params.get("until");

const PAUSE_SEC = 12; // timed-mode gate (no mic) before the escape hatch unlocks
const CAL_MS = 1500;  // ambient calibration window
const FLAT_MIN = 0.18; // spectral flatness gate: broadband breath vs tonal noise

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

const $ = (id) => document.getElementById(id);
function setText(id, v) { const el = $(id); if (el) el.textContent = v; }
function setHTML(id, v) { const el = $(id); if (el) el.innerHTML = v; }

function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function computeStreak(byDay) {
  let streak = 0;
  const now = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const c = byDay[dateKey(d)] || 0;
    if (c > 0) streak++;
    else if (i === 0) continue;
    else break;
  }
  return streak;
}
function fmtDuration(mins) {
  if (mins >= 60) { const h = mins / 60; return `${h % 1 === 0 ? h : h.toFixed(1)}h`; }
  return `${mins}m`;
}
function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function contextByHour(h) {
  if (h >= 5 && h < 9) return "early — the morning sets the whole day";
  if (h >= 9 && h < 12) return "prime deep-work hours";
  if (h >= 12 && h < 14) return "midday — don't hand the afternoon to a feed";
  if (h >= 14 && h < 17) return "the afternoon dip — a walk beats a scroll";
  if (h >= 17 && h < 21) return "evening — guard what's left of today";
  return "late — tired brain, weakest judgment, the classic trap";
}
function clamp01(x) { return Math.max(0, Math.min(1, x)); }

// --- static bits ----------------------------------------------------------

if (site) setText("site", site);
if (until) {
  const [h, m] = until.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  setText("until", `${h12}:${String(m).padStart(2, "0")} ${period}`);
}
setText("creed", CREEDS[Math.floor(Math.random() * CREEDS.length)]);

const optionsLink = $("optionsLink");
if (optionsLink) {
  optionsLink.addEventListener("click", (e) => {
    e.preventDefault();
    if (optionsLink.classList.contains("locked")) return;
    chrome.runtime.openOptionsPage();
  });
}

let gateDone = false;
function unlockEscape() { if (optionsLink) optionsLink.classList.remove("locked"); }

// --- timed gate (default / fallback, no mic) ------------------------------

function startTimerGate() {
  const t0 = performance.now();
  const phaseFor = (ms) => {
    const p = ms % 10000;
    return p < 4000 ? "breathe in" : p < 5000 ? "hold" : "breathe out";
  };
  const iv = setInterval(() => {
    if (gateDone) return clearInterval(iv);
    const ms = performance.now() - t0;
    const remain = Math.max(0, Math.ceil(PAUSE_SEC - ms / 1000));
    setText("phase", phaseFor(ms));
    setText("count", String(remain));
    setText("lockmsg", remain > 0 ? `unlocks in ${remain}s` : "");
    if (remain <= 0) {
      clearInterval(iv);
      gateDone = true;
      setText("phase", "the wave passed");
      setText("surfSub", "nothing here got better while you waited. it never does.");
      setText("lockmsg", "");
      unlockEscape();
    }
  }, 200);
}

// --- live dB meter --------------------------------------------------------

function setMeter(rms) {
  const db = rms > 0 ? 20 * Math.log10(rms) : -80;
  const shown = Math.max(-80, Math.min(0, db));
  setText("db", String(Math.round(shown)));
  const fill = $("meterFill");
  if (fill) fill.style.width = Math.max(0, Math.min(100, ((shown + 70) / 60) * 100)) + "%";
}

// --- breath gate: a live, reactive tutor ----------------------------------

function scoreBreath(i, h, e) {
  const total = i + h + e;
  const lengthScore = clamp01(total / 12);              // slow & long ≈ calm
  const exhaleScore = clamp01((e / Math.max(i, 0.5)) / 1.5); // exhale ≥ inhale is ideal
  const holdScore = h <= 0 ? 0 : clamp01(Math.min(h, 4) / 2); // a real ~2s hold
  return Math.round(100 * (0.45 * lengthScore + 0.35 * exhaleScore + 0.2 * holdScore));
}

function startBreathGate(sim) {
  const surf = $("surf");
  const orb = $("orb");
  const orbFill = orb ? orb.querySelector(".orb-fill") : null;
  const meter = $("meter");
  const timers = $("timers");
  if (surf) surf.classList.add("breath");

  const SAFETY_MS = sim ? 1e9 : 35000; // never trap: release regardless
  const gateStart = performance.now();
  let stream = null;
  let audioCtx = null;
  let analyser = null;
  let started = false;   // a detection mode (mic or tap) is running
  let aborted = false;   // signal the current loop to stop (e.g. switching to tap)
  let micSignal = false; // mic produced real, above-floor signal at least once
  let detState = "idle"; // current detection state (for the silent-mic watchdog)

  function cleanup() {
    try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
    try { if (audioCtx) audioCtx.close(); } catch (e) {}
    stream = null; audioCtx = null; analyser = null;
  }
  window.addEventListener("pagehide", cleanup);

  const safety = setInterval(() => {
    if (gateDone) return clearInterval(safety);
    if (performance.now() - gateStart >= SAFETY_MS) {
      clearInterval(safety);
      cleanup();
      gateDone = true;
      setText("phase", "released");
      setText("surfSub", "you sat with the urge. that counts — go.");
      setText("lockmsg", "");
      if (meter) meter.setAttribute("hidden", "");
      unlockEscape();
    }
  }, 300);

  // Real signal: RMS envelope + spectral flatness from the live mic.
  function makeRealGetRms() {
    const buf = new Float32Array(analyser.fftSize);
    const freq = new Float32Array(analyser.frequencyBinCount);
    return () => {
      analyser.getFloatTimeDomainData(buf);
      let s = 0;
      for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      const rms = Math.sqrt(s / buf.length);
      analyser.getFloatFrequencyData(freq);
      let logSum = 0, linSum = 0, n = 0;
      for (let i = 1; i < freq.length; i++) {
        const m = Math.pow(10, freq[i] / 20);
        logSum += Math.log(m + 1e-9);
        linSum += m;
        n++;
      }
      const flat = Math.exp(logSum / n) / (linSum / n + 1e-9);
      return { rms, flat };
    };
  }

  // Simulated signal (?preview=breath): scripts a real inhale→hold→exhale curve
  // so the whole state machine + scoring runs with no mic.
  function makeSimGetRms() {
    return (ms) => {
      if (ms < 2000) return { rms: 0.004, flat: 0.2 };                       // quiet
      if (ms < 5000) return { rms: 0.032 + 0.004 * Math.sin(ms / 120), flat: 0.5 }; // inhale 3s
      if (ms < 6500) return { rms: 0.004, flat: 0.2 };                       // hold 1.5s
      if (ms < 11500) return { rms: 0.06 + 0.01 * Math.sin(ms / 100), flat: 0.6 };  // exhale 5s
      return { rms: 0.004, flat: 0.2 };                                      // done
    };
  }

  function chip(id, cls) {
    const el = $(id);
    if (!el) return;
    el.classList.remove("active", "done");
    if (cls) el.classList.add(cls);
  }
  const fmt = (s) => Math.max(0, s).toFixed(1) + "s";

  function beginMic(getRms) {
    started = true;
    const startBtn = $("surfStart");
    if (startBtn) startBtn.setAttribute("hidden", "");
    if (meter) meter.removeAttribute("hidden");
    if (timers) timers.removeAttribute("hidden");
    if ($("diag")) $("diag").removeAttribute("hidden");
    if (surf) surf.classList.add("live"); // JS drives the orb from energy
    setText("lockmsg", "mic · offline");

    const t0 = performance.now();
    let calSum = 0, calSq = 0, calN = 0;
    let onThr = 0.012, offThr = 0.007;
    let ema = 0, loudFor = 0, quietFor = 0, lastT = t0;
    let state = "cal"; // cal → listen → inhale → hold → exhale → done
    let phaseStart = 0, frames = 0, peak = 0;
    const dur = { inhale: 0, hold: 0, exhale: 0 };
    const ON_MS = 220, OFF_MS = 220, END_MS = 350; // debounce per transition

    function loop() {
      if (gateDone || aborted) return;
      if (audioCtx && audioCtx.state === "suspended") audioCtx.resume(); // keep it awake
      const now = performance.now();
      const dt = now - lastT; lastT = now;
      const ms = now - t0;
      const { rms, flat } = getRms(ms);
      ema = ema ? ema * 0.7 + rms * 0.3 : rms;
      frames++; if (rms > peak) peak = rms;
      if (rms > 0.0008) micSignal = true; // the mic is alive (vs muted/wrong device)
      detState = state;
      setMeter(ema);
      const dEl = $("diag");
      if (dEl) dEl.textContent =
        `ctx ${audioCtx ? audioCtx.state : "sim"} · rms ${rms.toFixed(4)} · peak ${peak.toFixed(4)} · on ${onThr.toFixed(4)} · f${frames} · ${state}`;

      const loud = ema > onThr && flat > FLAT_MIN;
      const quiet = ema < offThr;
      if (loud) { loudFor += dt; quietFor = 0; }
      else if (quiet) { quietFor += dt; loudFor = 0; }

      if (state !== "cal") {
        const norm = clamp01((ema - offThr) / (onThr * 4));
        if (orbFill) orbFill.style.transform = "scale(" + (0.42 + norm * 0.6) + ")";
        if (orb) orb.classList.toggle("hit", loud);
      }

      switch (state) {
        case "cal":
          calSum += rms; calSq += rms * rms; calN++;
          setText("phase", "calibrating…");
          setText("surfSub", "one sec — stay quiet so it learns your room.");
          if (ms >= CAL_MS) {
            const mean = calSum / calN;
            const std = Math.sqrt(Math.max(0, calSq / calN - mean * mean));
            onThr = Math.max(mean + 5 * std, mean * 3, 0.012);
            offThr = Math.max(mean + 2 * std, mean * 1.7, 0.007);
            if (offThr >= onThr) offThr = onThr * 0.6;
            state = "listen";
            setText("phase", "start breathing");
            setText("surfSub", "inhale slowly — let the mic hear you.");
          }
          break;
        case "listen":
          if (loudFor >= ON_MS) {
            state = "inhale"; phaseStart = now - loudFor;
            chip("tInhale", "active");
            setText("phase", "inhaling…");
            setText("surfSub", "keep going… fill all the way up.");
          }
          break;
        case "inhale":
          dur.inhale = (now - phaseStart) / 1000;
          setText("tvInhale", fmt(dur.inhale));
          if (quietFor >= OFF_MS) {
            dur.inhale = (now - phaseStart - quietFor) / 1000;
            setText("tvInhale", fmt(dur.inhale));
            chip("tInhale", "done"); chip("tHold", "active");
            state = "hold"; phaseStart = now - quietFor;
            setText("phase", "hold it…");
            setText("surfSub", "gentle pause — no strain.");
          }
          break;
        case "hold":
          dur.hold = (now - phaseStart) / 1000;
          setText("tvHold", fmt(dur.hold));
          if (loudFor >= ON_MS) {
            dur.hold = (now - phaseStart - loudFor) / 1000;
            setText("tvHold", fmt(dur.hold));
            chip("tHold", "done"); chip("tExhale", "active");
            state = "exhale"; phaseStart = now - loudFor;
            setText("phase", "exhale… long & slow");
            setText("surfSub", "all the way out — toward the mic.");
          }
          break;
        case "exhale":
          dur.exhale = (now - phaseStart) / 1000;
          setText("tvExhale", fmt(dur.exhale));
          if (quietFor >= END_MS) {
            dur.exhale = (now - phaseStart - quietFor) / 1000;
            setText("tvExhale", fmt(dur.exhale));
            chip("tExhale", "done");
            return finishSession(dur);
          }
          break;
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  function finishSession(d) {
    if (gateDone) return;
    gateDone = true;
    aborted = true;
    cleanup();
    clearInterval(safety);
    if (orb) orb.classList.remove("hit");
    if (orbFill) orbFill.style.transform = "scale(0.6)";
    if (meter) meter.setAttribute("hidden", "");

    const score = scoreBreath(d.inhale, d.hold, d.exhale);
    let verdict, tip;
    if (score >= 85) { verdict = "Beautiful — slow and exhale-led."; tip = "that's the parasympathetic switch flipping."; }
    else if (score >= 70) { verdict = "Solid breath."; tip = "feel that? the urge's grip just loosened."; }
    else if (score >= 50) { verdict = "Good start."; tip = d.exhale < d.inhale ? "next time, make the exhale longer than the inhale." : "slow the whole thing down a touch."; }
    else { verdict = "A bit rushed."; tip = "slower and longer — the exhale does the calming."; }

    const scoreEl = $("score");
    if (scoreEl) scoreEl.removeAttribute("hidden");
    setText("scoreN", String(score));
    setText("scoreV", verdict);
    setText("phase", "breath complete ✓");
    setText("surfSub", tip);
    setText("lockmsg", "");
    unlockEscape();
  }

  // ===== tap-along fallback: reactive, no mic needed =====
  // Used when the mic is denied or stays silent. You tap the circle at each
  // phase boundary and it times inhale / hold / exhale exactly like the mic
  // path, then scores the breath. Reactive, not a metronome — your taps set
  // the pace. The button can never "do nothing": this always works.
  function beginTap() {
    aborted = false;
    started = true;
    cleanup(); // drop any half-open mic
    if (meter) meter.setAttribute("hidden", "");
    const dEl = $("diag");
    if (dEl) dEl.setAttribute("hidden", "");
    if (timers) timers.removeAttribute("hidden");
    setText("lockmsg", "tap mode");
    // keep the idle pulse alive until the first tap; then JS drives the orb

    let state = "idle"; // idle → inhale → hold → exhale → done
    let phaseStart = 0;
    const dur = { inhale: 0, hold: 0, exhale: 0 };
    const setOrb = (n) => { if (orbFill) orbFill.style.transform = "scale(" + (0.42 + clamp01(n) * 0.6) + ")"; };

    setText("phase", "tap the circle to begin");
    setText("surfSub", "tap it the moment you START to inhale.");
    if (orb) { orb.style.cursor = "pointer"; orb.classList.add("hit"); } // looks tappable

    // single rAF chain, started once; branches on state, stops at done
    function tick() {
      if (gateDone || state === "idle" || state === "done") return;
      const s = (performance.now() - phaseStart) / 1000;
      if (state === "inhale") { setText("tvInhale", fmt(s)); setOrb(s / 4); }
      else if (state === "hold") { setText("tvHold", fmt(s)); }
      else if (state === "exhale") { setText("tvExhale", fmt(s)); setOrb(1 - s / 6); }
      requestAnimationFrame(tick);
    }

    function advance() {
      if (gateDone) return;
      const now = performance.now();
      switch (state) {
        case "idle":
          if (surf) surf.classList.add("live"); // JS now drives the orb
          state = "inhale"; phaseStart = now;
          chip("tInhale", "active");
          setText("phase", "inhaling…");
          setText("surfSub", "breathe in slow… tap again when you're full.");
          requestAnimationFrame(tick);
          break;
        case "inhale":
          dur.inhale = (now - phaseStart) / 1000; setText("tvInhale", fmt(dur.inhale));
          state = "hold"; phaseStart = now;
          chip("tInhale", "done"); chip("tHold", "active");
          if (orb) orb.classList.remove("hit");
          setText("phase", "hold it…");
          setText("surfSub", "gentle pause… tap when you start to exhale.");
          break;
        case "hold":
          dur.hold = (now - phaseStart) / 1000; setText("tvHold", fmt(dur.hold));
          state = "exhale"; phaseStart = now;
          chip("tHold", "done"); chip("tExhale", "active");
          if (orb) orb.classList.add("hit");
          setText("phase", "exhale… long & slow");
          setText("surfSub", "breathe all the way out… tap when you're empty.");
          break;
        case "exhale":
          dur.exhale = (now - phaseStart) / 1000; setText("tvExhale", fmt(dur.exhale));
          chip("tExhale", "done");
          if (orb) orb.classList.remove("hit");
          state = "done";
          finishSession(dur);
          break;
      }
    }

    if ($("surfStart")) $("surfStart").setAttribute("hidden", "");
    if (orb) orb.addEventListener("click", advance);
    window.addEventListener("keydown", (e) => {
      if ((e.code === "Space" || e.code === "Enter") && !gateDone) { e.preventDefault(); advance(); }
    });
  }

  if (sim) return beginMic(makeSimGetRms());

  // Real mic: an explicit tap provides the user-gesture AudioContext requires.
  const startBtn = $("surfStart");
  const diagEl = $("diag");
  if (startBtn) startBtn.removeAttribute("hidden");
  if (diagEl) diagEl.removeAttribute("hidden");
  setText("phase", "ready when you are");
  setText("surfSub", "tap START — it listens to your breath. no mic? it switches to tap-along.");
  if (diagEl) diagEl.textContent = "ctx none · not started";

  let initing = false;
  const startOnce = async () => {
    if (started || initing) return;
    initing = true;
    if (startBtn) startBtn.setAttribute("hidden", "");
    setText("phase", "starting…");
    // Create + resume the AudioContext SYNCHRONOUSLY inside the tap, before the
    // async getUserMedia await can let the user-activation window expire — that
    // expiry is what leaves the context suspended (mic on, but analyser silent).
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtx.resume();
    } catch (e) { console.warn("[FG] AudioContext create failed:", e); }
    if (diagEl) diagEl.textContent = `ctx ${audioCtx ? audioCtx.state : "none"} · requesting mic…`;
    console.log("[FG] tap → ctx state:", audioCtx && audioCtx.state);
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (e) {
      // Denied / no device → don't dead-end; switch to the tap-along gate.
      console.warn("[FG] mic denied/failed → tap mode:", e && e.name, e && e.message);
      cleanup();
      setText("phase", "no mic — tap mode");
      setText("surfSub", "couldn't open the mic, so let's do this by tap instead.");
      return beginTap();
    }
    console.log("[FG] mic granted:", stream.getAudioTracks().map((t) => t.label));
    try {
      await audioCtx.resume();
      console.log("[FG] ctx after resume:", audioCtx.state, "sampleRate:", audioCtx.sampleRate);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
    } catch (e) {
      console.warn("[FG] analyser setup failed → tap mode:", e);
      return beginTap();
    }
    if (orb) orb.removeEventListener("click", startOnce);
    beginMic(makeRealGetRms());

    // Watchdog: mic granted but dead / muted / wrong device (no signal ever) → tap.
    const watchStart = performance.now();
    const micWatch = setInterval(() => {
      if (gateDone || aborted) return clearInterval(micWatch);
      if (micSignal) return clearInterval(micWatch); // mic is alive — keep listening
      if (performance.now() - watchStart > 6000 && (detState === "cal" || detState === "listen")) {
        clearInterval(micWatch);
        console.warn("[FG] mic silent 6s → tap mode");
        aborted = true; // stop the mic loop
        setText("phase", "mic too quiet — tap mode");
        setText("surfSub", "not hearing your breath — switching to tap.");
        setTimeout(() => { started = false; beginTap(); }, 60);
      }
    }, 500);
  };
  if (startBtn) startBtn.addEventListener("click", startOnce);
  if (orb) orb.addEventListener("click", startOnce);
}

// --- choose the gate ------------------------------------------------------

async function startGate() {
  if (params.get("preview") === "breath") return startBreathGate(true);
  if (params.get("gate") === "mic") return startBreathGate(false); // force, ignore setting
  let breathLock = false;
  try {
    const s = await chrome.storage.sync.get({ breathLock: false });
    breathLock = s.breathLock;
  } catch (e) {}
  if (breathLock && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    return startBreathGate(false);
  }
  startTimerGate();
}

// --- price, context, banked record ----------------------------------------

async function render() {
  let minutesPerBlock = 12;
  let byDay = {};
  let bySite = {};
  try {
    const sync = await chrome.storage.sync.get({ minutesPerBlock: 12 });
    const local = await chrome.storage.local.get({ stats: { byDay: {}, bySite: {} } });
    minutesPerBlock = sync.minutesPerBlock || 12;
    byDay = (local.stats && local.stats.byDay) || {};
    bySite = (local.stats && local.stats.bySite) || {};
  } catch (e) {
    /* preview / no extension context — defaults */
  }

  const yearlyHours = Math.round((minutesPerBlock * 365) / 60);
  const workDays = Math.max(1, Math.round(yearlyHours / 8));
  const decadeDays = Math.round((yearlyHours * 10) / 24);
  const decadeMonths = Math.round(decadeDays / 30.44);
  const decadeText =
    decadeDays < 24 ? `${decadeDays} days` : decadeMonths <= 1 ? "a month" : `${decadeMonths} months`;

  setText("now", `${minutesPerBlock} min`);
  setText("hero", String(yearlyHours));
  setText("priceFoot", `≈ ${workDays} full work-days a year · ${decadeText} of your life every decade`);

  const now = new Date();
  const hh = now.getHours();
  const timeStr = `${String(hh).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const todayCount = byDay[dateKey(now)] || 0;
  setHTML(
    "context",
    `<b>${timeStr}</b> · ${contextByHour(hh)} · this is your <b>${ordinal(Math.max(1, todayCount))}</b> intercept today`
  );

  const refusedHere = site ? bySite[site] || 0 : 0;
  const totalIntercepts = Object.values(byDay).reduce((a, b) => a + b, 0);
  const streak = computeStreak(byDay);
  const reclaimedStr = fmtDuration(totalIntercepts * minutesPerBlock);
  setText("siteCount", `${refusedHere}×`);
  setText("streak", String(streak));
  setText("reclaimed", reclaimedStr);
  setHTML(
    "bankedNote",
    `switching FG-1 off forfeits your <b>${streak}-day streak</b> and the <b>${reclaimedStr}</b> you've banked. that's the only way to lose it.`
  );
}

startGate();
render();
