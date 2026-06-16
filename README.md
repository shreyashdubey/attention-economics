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
  count.
- **Settings** — add one or more block windows (e.g. `07:00–21:00` for work and
  `23:00–06:00` for sleep), edit the blocked-site list, set the daily-summary
  time.
- **Progress page** — intercepts today, day streak, estimated time reclaimed, and
  a 7-day chart.
- **Daily summary** — a notification at your chosen time recapping the day.

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

All data — your settings and intercept counts — lives in Chrome's local/sync
storage on your machine. Nothing is sent anywhere.

## Files

| File              | Purpose                                      |
| ----------------- | -------------------------------------------- |
| `manifest.json`   | Extension manifest                           |
| `background.js`   | Service worker — blocking + stats + summary  |
| `blocked.html/js` | The page shown when a site is blocked        |
| `options.html/js` | Settings (windows, sites, summary time)      |
| `stats.html/js`   | Your progress dashboard                      |
| `popup.html/js`   | Toolbar popup                                |
| `icons/`          | Extension icons                              |
