# Changelog

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
