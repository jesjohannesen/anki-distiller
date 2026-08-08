# Preview harness

Renders Distiller's UI in an ordinary browser tab, with no build and no extension
installed. Useful for working on the panel or the settings page without a
build → reload → click cycle each time.

```bash
python3 -m http.server 8800     # from the repo root
```

- <http://127.0.0.1:8800/preview/panel-demo.html> — the review panel over a sample
  article, wired to canned card data
- <http://127.0.0.1:8800/preview/options-demo.html> — the settings page with a fake
  key, a fake model catalogue, a fake Anki, and four runs of cost history

Both load the real files from `../Extension/`, so what you see is the shipping code.

## How it works

`stub.js` defines `window.browser` before `lib/shim.js` runs, so the extension code
picks it up as the WebExtension namespace. It fakes:

- `runtime.sendMessage` — an in-memory router mirroring the handlers in
  `background.js`, returning sample cards, decks, models and key status. `distil`
  resolves after 1.4 s so the loading state is visible.
- `storage.local` — a plain object.
- `runtime.getURL` — rewrites to `../Extension/…` so the panel's stylesheet fetch
  resolves.

`options-demo.html` is a copy of `Extension/options/options.html` with the script
paths rewritten and `stub.js` inserted first. **If you change the options page's
`<script>` or `<link>` tags, regenerate it** — otherwise the copy silently drifts:

```bash
python3 - <<'PY'
import pathlib
html = pathlib.Path('Extension/options/options.html').read_text()
html = (html
    .replace('href="options.css"', 'href="../Extension/options/options.css"')
    .replace('<script src="../lib/shim.js"></script>',
             '<script src="stub.js"></script>\n  <script src="../Extension/lib/shim.js"></script>')
    .replace('<script src="../lib/', '<script src="../Extension/lib/')
    .replace('<script src="options.js"></script>',
             '<script src="../Extension/options/options.js"></script>'))
pathlib.Path('preview/options-demo.html').write_text(html)
PY
```

## What it can't tell you

The stub answers instantly and always succeeds. It does not exercise real OpenRouter
responses, real AnkiConnect behaviour, Safari's permission prompts, or article
extraction on a hostile page. Verify those in a real build.
