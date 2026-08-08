# Architecture

Three pieces, one rule: **the content script never sees a secret and never makes a
network call.**

```
┌─ page (untrusted) ──────────────────────────────────────────────┐
│  content/extract.js   reads the DOM, returns {title, text, …}   │
│  content/panel.js     shadow-root UI, editing, deck picking     │
└──────────────────────────┬──────────────────────────────────────┘
                           │ runtime.sendMessage — plain JSON only
┌──────────────────────────▼──────────────────────────────────────┐
│ background.js (service worker)                                  │
│   holds the API key, owns storage, makes every fetch            │
│   lib/openrouter.js   chat + model catalogue + pricing          │
│   lib/anki.js         AnkiConnect                               │
│   lib/prompt.js       prompt building + response parsing        │
│   lib/ledger.js       local cost history                        │
│   lib/settings.js     defaults + read/write                     │
└──────────────────────────┬──────────────────────────────────────┘
                           │
        openrouter.ai (https)        127.0.0.1:8765 (AnkiConnect)
```

Why this split:

- **CSP.** A content script inherits the page's Content-Security-Policy. On sites with
  a strict `connect-src` a `fetch` to openrouter.ai from the page context is simply
  blocked. From the worker it always works.
- **Secrets.** A content script runs in an isolated world, but it is still injected
  into a page the user did not write. There is no reason for the key to be there, so
  it isn't: the panel bootstraps with `{hasKey: true}`, never the key itself.

## Files

| File | Responsibility |
| --- | --- |
| `manifest.json` | MV3. `activeTab` + `scripting` (inject on click, not on every page), `storage`. Host permissions for openrouter.ai and localhost:8765 only. |
| `background.js` | Toolbar click → inject → open panel. Message router. `distil()` orchestration. |
| `lib/shim.js` | `browser` if present, else `chrome`. Safari has both; Chrome has one. |
| `lib/settings.js` | `DEFAULTS`, `getSettings`, `setSettings`. All keys documented in one object. |
| `lib/ledger.js` | Append-only local cost log, ring-buffered at `ledgerLimit`, plus summaries and CSV. |
| `lib/openrouter.js` | `orChat`, `orModels` (24 h cached), `orKeyStatus`, HTTP-status-to-English. |
| `lib/anki.js` | `ankiInvoke` and friends; `requestPermission`, `deckNames`, `addNotes`. |
| `lib/prompt.js` | `BUILTIN_SYSTEM_PROMPT`, prompt assembly, and `parseCards` (tolerant JSON extraction, normalisation, de-duplication). |
| `content/extract.js` | Readability-lite. Exposes `window.__distillerExtract()`. |
| `content/panel.js` | The whole UI, built with a 20-line `h()` helper. No `innerHTML` for any text that came from the page or the model. |
| `content/panel.css` | Loaded into the shadow root by `fetch(runtime.getURL(...))`. |
| `options/*` | Settings page. Reads and writes storage directly; delegates network to the worker. |

## Message protocol

Every message is `{type, payload}`; every reply is `{ok: true, data}` or
`{ok: false, error: {message, kind}}`. The router in `background.js` wraps handler
rejections, so a handler just throws.

| Type | Payload | Returns |
| --- | --- | --- |
| `ui:bootstrap` | — | `{hasKey, model, targetCards, deck, showCosts}` — the redacted view the panel gets |
| `settings:get` / `settings:set` | `{patch}` | full settings (options page only) |
| `models:list` | `{force}` | `[{id, name, context, promptPrice, completionPrice}]` |
| `key:status` | `{apiKey}` | `{label, usage, limit, limitRemaining, isFreeTier}` |
| `distil` | `{article, focus, model}` | `{summary, cards, model, usage, elapsedMs}` |
| `anki:status` | — | `{version, decks, models}` |
| `anki:connect` | — | same, after the in-Anki permission dialog |
| `anki:fields` | `{noteType}` | field names |
| `anki:add` | `{cards, deck, source}` | `{added, skipped, ids, deck}` |
| `ledger:summary` / `ledger:all` / `ledger:clear` | — | cost history |
| `options:open` | — | `true` |

## The distil path

1. `action.onClicked` → `openPanel(tab)`. It tries `sendMessage` first; if that throws,
   nothing is injected yet, so it injects `extract.js` + `panel.js` and sends again.
   Pressing the button while the panel is open closes it.
2. The panel calls `window.__distillerExtract()` in the page and renders the setup view
   with the word count and a token estimate.
3. **Distil** sends the article to the worker, which builds the prompt
   (`lib/prompt.js`), calls OpenRouter with `usage: {include: true}`, parses the JSON
   out of whatever the model wrapped it in, de-duplicates on the question text, and
   attaches tags.
4. The run is appended to the cost ledger **unconditionally**; `usage` is only returned
   to the UI when `showCosts` is on. That way turning the display on later shows real
   history rather than an empty table.
5. The panel renders editable cards and asks the worker for deck names in parallel.
6. **Add** sends the surviving cards. `addNotes` returns `null` for each note Anki
   rejected as a duplicate, so partial success is normal and is reported as
   "N skipped as duplicates" rather than swallowed.

## Article extraction

`extract.js` is a small Readability: clone the body, strip scripts/nav/aside and
anything whose id or class matches a junk pattern, score each block's ancestors by how
much punctuated prose they contain (discounted by link density), take the winner, and
serialise it back in document order with `##` for headings and `-` for list items.

It falls back to `document.body.innerText` when that yields less than 400 characters,
and an explicit selection longer than 400 characters always wins — a user selecting
text is a stronger signal than any heuristic.

It doesn't have to be perfect. Models tolerate a stray "Related articles" heading far
better than they tolerate a missing article body, so every ambiguous case resolves
towards including more.

## Cost accounting

`usage: {include: true}` asks OpenRouter to return the amount actually charged for the
call. When a provider omits it, `lib/openrouter.js` falls back to the cached catalogue
pricing and marks the entry `costIsEstimate`, which the UI renders with an asterisk.
Estimates are never silently presented as charges. Details in [COSTS.md](COSTS.md).

## Deliberate omissions

- **No streaming.** It saves a few seconds of perceived latency and costs a
  meaningfully more complex parser, since the JSON is only valid once complete.
- **No `response_format: json_schema`.** Support is uneven across the ~400 models in
  the catalogue and OpenRouter's behaviour on unsupported params varies by provider.
  A tolerant parser handles every model instead of a subset.
- **No bundler, no dependencies.** The extension is the source. `Extension/` loads
  unpacked in Chrome and Firefox with no build step.
