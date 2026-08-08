# Changelog

## 1.0.11 — 2026-08-08

The click arrived and was thrown away one line later.

- `openPanel` probed with `tabs.sendMessage` first and treated a rejection as
  "nothing injected yet". Chrome rejects that call when no content script is
  listening; **Safari resolves it**. So the probe always looked like success,
  `openPanel` returned "already injected", and nothing was ever injected on any
  page. The background console showed the click arriving and then silence.
- Inject unconditionally instead, then message. Both content scripts already guard
  against running twice, and `panel.js` no longer opens itself on a repeat injection
  — the `panel:open` message drives that, so a second click still toggles the panel
  shut.
- The content script now returns a positive `{ok: true}` acknowledgement, and a
  missing ack is treated as failure. Silence cannot be read as success on a platform
  that resolves messages into the void.
- The panel reveals itself via `requestAnimationFrame` with a timer fallback; rAF
  does not fire in a backgrounded tab, which would mount the panel at opacity 0.


## 1.0.8 — 2026-08-08

Safari never loads the MV3 service worker, so the toolbar click went nowhere.

- Develop ▸ Web Extension Background Content lists Distiller as **"ikke innlastet"**
  (not loaded), and pressing the toolbar button does not start it. With no background
  running there is no `action.onClicked` listener, which is why the button did nothing
  regardless of signing, Launch Services or host permissions — all of which were
  correct by this point.
- Safari builds now use a **background page** by default (`background.scripts`).
  `Extension/manifest.json` keeps `service_worker` for Chrome, `background.js` runs
  under both, and `DISTILLER_SERVICE_WORKER=1` restores the old behaviour.
- This was tried in 1.0.5 and reverted, because "Failed to load data for extension"
  appeared alongside it. That turned out to be the stale Launch Services records
  landing in the same second (app mtime 16:11:18, failure 16:11:18.584), not the
  manifest. With those cleaned up, Safari accepts this manifest and logs no failure.


## 1.0.6 — 2026-08-08

Safari had the extension blocked outright, which masked everything else.

- Safari resolves an extension through its containing app's Launch Services record.
  Every rebuild did `rm -rf` + `ditto` on the installed app while Safari was running,
  and each one left another record behind — nine of them accumulated, pointing at
  purged caches, deleted build directories and Trashed copies. Safari resolved a dead
  one, logged `Couldn't find LSApplicationRecord`, and then **disabled and blocked the
  extension**. It stayed blocked regardless of what was fixed afterwards, which is why
  the toolbar button did nothing even from a handler that runs before any fallible
  code.
- `build-safari.sh` now unregisters the build product and known stale copies,
  registers exactly one record, and warns if others remain.
- `diagnose.sh` gained a Launch Services section that counts competing records and
  reports Safari's `LSApplicationRecord` failures.
- Reverted the 1.0.5 background-page rewrite. It was a response to "Safari never
  starts the service worker", an observation made while the extension was blocked and
  therefore worth nothing; it was also the only change that ever produced "Failed to
  load data for extension" in Safari's log. Still available behind
  `DISTILLER_BACKGROUND_PAGE=1` if the service worker turns out to be a real problem.


## 1.0.5 — 2026-08-08

Safari never started the background service worker, so the button was inert.

- No `action.onClicked` listener existed, because Safari registered no service
  worker for the converted extension at all — nothing in the system log, no
  background content in the Develop menu, and a press produced no acknowledgement
  even from a handler that runs before anything that can fail. Permissions and
  signing were both already correct by this point; neither was the cause.
- `scripts/build-safari.sh` now rewrites the copied manifest to a **non-persistent
  background page**, listing the libraries as scripts. `Extension/manifest.json`
  keeps `service_worker` so the source still loads unpacked in Chrome, and
  `background.js` detects which shape it is in and only calls `importScripts` when
  the libraries are not already loaded. Both shapes are covered by tests.


## 1.0.3 — 2026-08-08

Safari could never grant access to the pages being read.

- `host_permissions` declared only openrouter.ai and localhost, with `activeTab`
  meant to cover the article page. Chrome grants `activeTab` on a toolbar click;
  Safari does not expose it as a website permission at all, so Safari ▸ Settings ▸
  Websites ▸ Distiller listed only `openrouter.ai` and there was no control for
  anything else. `scripting.executeScript` therefore had no access to any article
  page and the button did nothing. Declare `http://*/*` and `https://*/*` so the
  "All other websites" control exists.
- Behaviour is unchanged: no content script is declared and injection still happens
  only from the toolbar click. PRIVACY.md now explains why the declared permission is
  broader than what the code does.

## 1.0.2 — 2026-08-08

The build script was installing the app somewhere macOS deletes.

- `build-safari.sh` built into `~/Library/Caches/…` and left the finished `.app`
  there. macOS purges that directory on its own schedule; when it did, the app
  vanished, Safari lost the extension, and the toolbar button did nothing with no
  background page left to inspect. The script now builds in
  `~/Library/Developer/anki-distiller` and **installs to `/Applications`**, refuses
  to build under `~/Library/Caches`, verifies the installed signature, registers the
  app with Launch Services, and prints the installed version.
- Removed the manual "copy it to /Applications yourself" step from the install doc;
  the script does it.
- Added `DISTILLER_INSTALL_DIR` for choosing where the app lands.
- New `scripts/diagnose.sh`: reports install path, system registration, signature
  status, and whether Safari has actually tried to load the extension — including
  the "Computing the code signing dictionary failed" rejection that Safari logs for
  ad-hoc signed extensions. `--watch` streams Safari's log live while you press the
  button.
- The build script now warns loudly when it produces an ad-hoc signed app, and both
  it and the docs give the enable steps in the order that actually works (quit Safari
  first — Allow Unsigned Extensions resets on launch).

## 1.0.1 — 2026-08-08

Fixes the toolbar button doing nothing in Safari.

- `openPanel` no longer gates on `tab.url`. Safari withholds it unless the extension
  holds the `tabs` permission, so the check saw an empty string and refused to inject
  on every page — silently, with nothing logged.
- A failed start is now visible: a red `!` badge on the toolbar button and the reason
  in its tooltip, including the exact fix for the common case (site access not
  granted).

## 1.0.0 — 2026-08-08

First release.

- Toolbar button distils the current article into Anki flashcards via any OpenRouter
  model.
- Readability-lite article extraction, with an explicit text selection taking
  precedence.
- In-page review panel: editable cards, per-card skip and delete, deck picker.
- Saves to Anki desktop through AnkiConnect, with a TSV download and clipboard export
  as fallback when Anki isn't running.
- Per-card topic tags plus `distiller` and the source domain; optional source link on
  the back of each card.
- Local cost ledger with a spending panel, hidden behind an Advanced toggle.
- Settings page: key check with credit balance, live model catalogue with pricing,
  Anki connect flow, custom system prompt override.
