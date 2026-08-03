# Prism — colorful week calendar

A single-page weekly calendar. Seven day tiles, each in its own colour; click any
tile to add tasks to that day's numbered list. No dependencies, no build step,
no server required — open `index.html` and it runs.

![Seven colourful day tiles on a desktop screen](docs/desktop.png)

## Features

- **Seven day tiles**, one per weekday, each with its own gradient identity.
- **Click anywhere on a tile** to open the composer and add a task to that day.
- Tasks render as a **numbered list** (`<ol>`); the numbers renumber themselves
  when items are added or removed.
- **Tap a task** to mark it done, **×** to delete it.
- Keep the composer open to add several tasks in a row — <kbd>Enter</kbd> adds,
  <kbd>Esc</kbd> closes.
- **Week navigation** with ‹ / › or the <kbd>←</kbd> / <kbd>→</kbd> arrow keys,
  and a **Today** button.
- **Clear week** wipes only the seven days currently on screen.
- Week totals and completed count in the footer.
- Everything is saved to `localStorage`, so tasks survive a reload.
- **Automatic dark mode** (follows the OS setting) and reduced-motion support.

## Responsive behaviour

| Width | Layout |
| --- | --- |
| ≥ 1181px | all seven days on one row |
| 901–1180px | 4 columns |
| 701–900px | 3 columns |
| ≤ 700px (iPhone) | single column of compact rows; the composer becomes a bottom sheet |

The phone layout uses `env(safe-area-inset-*)` so it clears the notch and home
indicator, keeps tap targets comfortable, and sets a 16px input font so iOS
doesn't zoom when the composer is focused.

<img src="docs/iphone.png" alt="Single-column layout on an iPhone" width="320">

## Running it

```bash
open index.html          # macOS — or just double-click the file
python3 -m http.server   # any static server works too
```

## Installing it on an iPhone

The app ships as an installable PWA: a web app manifest, app icons, and a
service worker that caches the shell so it opens with no connection.

1. **Publish it.** In this repo, go to **Settings → Pages** and set the source
   to *Deploy from a branch* → `master` → `/ (root)`. GitHub gives you a
   `https://<user>.github.io/calendar-baner/` URL a minute later. Any HTTPS
   static host works equally well — the paths are all relative.
2. **Open that URL in Safari** on the iPhone (it must be Safari; other iOS
   browsers can't install to the home screen).
3. **Share → Add to Home Screen.** You get a Prism icon that launches
   full-screen with no browser chrome, and keeps working offline.

Tasks live in that origin's `localStorage`, so the installed app and the same
URL in Safari share one list. Serving over HTTPS (or `localhost`) is required —
a service worker won't register on `file://`, and the app quietly skips
registration there rather than erroring.

## Cross-device sync (Cloudflare Pages + D1)

Sync is optional. With no key set the app is purely local, exactly as before.
Set one and the same task list follows you between phone and laptop.

**Shape:** Pages serves the static app. A Pages Function — a Worker on the same
origin, so no CORS — answers `POST /api/sync`. Tasks live in D1, Cloudflare's
managed SQLite.

**Merge rules:** the client posts the tasks it changed since its last sync plus
that sync's cursor, and gets back everything the server has seen since. Conflicts
resolve last-write-wins per task id on the `updated` timestamp. Deletes are
tombstones (`deleted = 1`), so a deletion on one device removes the task on the
others instead of the task reappearing.

**Offline:** every change is written to `localStorage` and rendered first, then
pushed. Edits made with no connection queue up and flush on reconnect — the
service worker never caches `/api/`.

### Deploying it

```bash
npm install
npm run db:create        # prints database_id — paste it into wrangler.toml
npm run db:init          # creates the tasks table in D1
npm run deploy           # publishes the Pages project
npm run secret           # set SYNC_KEY — the value you'll enter in the app
```

Then open the Pages URL, click **Sync off** in the footer, paste the same key,
and press Connect. Repeat on the iPhone and both devices share one list.

To run it locally with a real (local) D1 file:

```bash
npm run db:init:local
npx wrangler pages dev . --binding SYNC_KEY=dev-key
```

### Security

The key is a shared secret checked with a constant-time comparison; anyone
holding it can read and write your tasks, so treat it like a password and serve
only over HTTPS (Pages does). It's stored in `localStorage` on each device you
connect. For something stronger, put Cloudflare Access in front of `/api/*`.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | markup, composer dialog, sync panel |
| `styles.css` | design tokens, tile styling, responsive rules, dark mode |
| `app.js` | task state, `localStorage` persistence, rendering, sync client |
| `functions/api/sync.js` | Pages Function: auth, validation, D1 merge |
| `schema.sql` | the `tasks` table and its indexes |
| `wrangler.toml` | Pages project config and the D1 binding |
| `sw.js` | service worker: offline app shell |
| `manifest.webmanifest`, `icons/` | home-screen install metadata |

## Notes

- Without a sync key, data is stored per browser under `prism.calendar.v2`
  (upgraded automatically from the older `prism.calendar.v1` layout) and
  nothing leaves the device.
- Task text is inserted with `textContent`, so anything typed is displayed
  literally rather than parsed as HTML.
- The week starts on Monday. Change `WEEK_STARTS_ON` in `app.js` to `0` for
  Sunday, or raise `DAYS_SHOWN` to display more than seven days.
- Sync timestamps come from each device's own clock. A phone with a badly wrong
  clock could win a conflict it shouldn't; ordinary drift is harmless.
