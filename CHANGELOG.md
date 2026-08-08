# Changelog

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
