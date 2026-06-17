# Focus Guard — Time-Based Site Blocker

A Chrome extension (Manifest V3) that blocks distracting sites during the hours
you choose, counts the urges it intercepts, and shows your daily progress.

## Install (unpacked)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder (`attention-economics`).
4. Make sure you're loading it **into your own Chrome profile (Shreyash)**.
5. Pin "Focus Guard" from the puzzle-piece menu.

## Use

- **Toolbar popup** — quick on/off toggle, current status, and today's intercept
  count. "Open console" opens the single full-page console.
- **Console** (one page, opens via the popup or extension options) — combines:
  - _Monitor_: intercepts today, day streak, estimated time reclaimed, 7-day chart.
  - _Controls_: block windows (e.g. `07:00–21:00` for work and `23:00–06:00` for
    sleep), the blocked-site list, daily-summary time.
- **Daily summary** — a notification at your chosen time recapping the day.
- **Power-down sequence** — turning blocking OFF is deliberately hard: flip three
  safety switches, then hold a button for 3 seconds. Turning it back ON is instant.
  (This is the friction that stops a weak-moment one-click disable.)
- **Adaptive learning (INTEL panel)** — the extension measures *active* foreground
  time per site (idle-aware, local only). When a site you don't block starts eating
  your week, it surfaces it under INTEL with one-click **Block / Dismiss**, and fires
  a suggestion notification. Flip **auto-block** on to add new time-sinks
  automatically. A built-in productivity allowlist (github, gmail, docs, etc.) is
  never suggested. So the block list keeps up when you migrate from one distraction
  to the next.

The whole UI is styled after Teenage Engineering (OP‑1 / OP‑XY): brushed-aluminum
faceplates, International Orange `#fe5000`, encoder knobs, OLED display screens,
and bundled Space Mono + Silkscreen fonts (see `te.css`).

## How it works

- A background service worker checks every navigation. If the local time is
  inside any block window **and** the destination matches a blocked domain, the
  tab is redirected to a calm block page and the intercept is counted.
- A 1-minute alarm re-scans open tabs so an already-open tab gets blocked the
  moment a window begins.
- Domain matching covers subdomains (`youtube.com` also blocks `m.youtube.com`).
- Multiple windows and overnight windows (`23:00 → 06:00`) are supported.

## Incognito

Extensions do **not** run in Incognito unless you allow it:
`chrome://extensions` → Focus Guard → **Details** → enable **Allow in
Incognito**. (See the chat for the catch about a determined workaround.)

## Privacy

All data — settings, intercept counts, and the per-site active-time the adaptive
learning uses — lives in Chrome's local/sync storage on your machine. **Nothing is
ever sent anywhere.** The `idle` permission is only used to avoid counting time when
you're away from the keyboard.

## Files

| File              | Purpose                                          |
| ----------------- | ------------------------------------------------ |
| `manifest.json`   | Extension manifest                               |
| `background.js`   | Service worker — blocking, stats, usage tracking |
| `blocked.html/js` | The page shown when a site is blocked            |
| `options.html`    | The single console (monitor + intel + controls)  |
| `options.js`      | Settings logic (windows, sites, summary)         |
| `stats.js`        | Monitor logic (counts, streak, chart)            |
| `patterns.js`     | INTEL panel — adaptive suggestions               |
| `arming.js`       | Power-down confirmation sequence                 |
| `popup.html/js`   | Toolbar popup                                    |
| `te.css`          | Teenage Engineering design system                |
| `fonts/`          | Space Mono + Silkscreen (bundled, OFL)           |
| `icons/`          | Extension icons                                  |
