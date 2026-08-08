# Distiller

A Safari extension that turns the article you're reading into a handful of Anki
flashcards — not summaries of the page, but the **transferable learnings**: the
mechanisms, causes and durable facts you'd want to still know in a year.

Press the toolbar button. A panel slides in, reads the article, sends it to whichever
model you picked on [OpenRouter](https://openrouter.ai), and shows you the cards it
wrote. Edit them, drop the weak ones, and push the rest straight into Anki.

```
 ┌──────────────────┐   article text    ┌───────────────┐   cards   ┌──────────┐
 │ page you're on   │ ────────────────► │  OpenRouter   │ ────────► │  panel   │
 └──────────────────┘                   │  (your model) │           │ (review) │
                                        └───────────────┘           └────┬─────┘
                                                                         │ approved
                                            ┌────────────────────────────▼──────┐
                                            │ Anki desktop via AnkiConnect      │
                                            │ (or a TSV export if Anki is shut) │
                                            └───────────────────────────────────┘
```

## What it does

- **One button.** No highlighting, no selecting — it finds the article body itself.
  (If you *do* select a passage first, it cards just that.)
- **Any model on OpenRouter.** A curated shortlist in the panel, the full ~400-model
  catalogue with live pricing in settings.
- **Cards worth keeping.** The prompt is built around one rule: a card must be
  answerable by someone who never read the article. No "what did the author argue",
  no padding to hit a number. See [docs/PROMPT.md](docs/PROMPT.md).
- **Review before saving.** Every card is editable in place; skip or delete any of them.
- **Straight into Anki** through AnkiConnect, with per-card topic tags and a link back
  to the source. If Anki isn't running you get a TSV to import instead.
- **Cost tracking, off by default.** Switch it on in Advanced and you get a per-run
  price under the cards plus a local spending panel. See [docs/COSTS.md](docs/COSTS.md).

## Install

Full walkthrough in **[docs/INSTALL.md](docs/INSTALL.md)**. The short version:

```bash
git clone https://github.com/jesjohannesen/anki-distiller.git
cd anki-distiller
./scripts/build-safari.sh --open
```

If the toolbar button ever seems dead, `./scripts/diagnose.sh` says why.

Then Safari ▸ Settings ▸ Extensions ▸ enable **Distiller**, and paste an
[OpenRouter key](https://openrouter.ai/keys) into its settings. Without an Apple
developer identity you'll also need Develop ▸ Allow Unsigned Extensions — the install
doc covers that and the Anki side.

## Daily use

1. Open an article. Press the Distiller button (or ⌘⇧D).
2. Pick a model and roughly how many cards. Optionally add a focus
   ("weight this towards the mechanisms, skip the policy history").
3. Press **Distil**. Ten to thirty seconds later you get cards.
4. Edit, skip what's weak, choose a deck, press **Add**.

Keep Anki desktop open and the cards land in it immediately, tagged `distiller`, the
site's domain, and a topic tag the model chose.

## Repo layout

```
Extension/            the web extension — the single source of truth
  manifest.json
  background.js       service worker: all network calls, all storage
  lib/                settings, cost ledger, OpenRouter, AnkiConnect, prompt
  content/            article extraction + the in-page review panel
  options/            settings page
docs/                 install, architecture, prompt design, costs, troubleshooting
preview/              render the UI in a plain browser tab, no install needed
scripts/              build-safari.sh, diagnose.sh, make-icons.py
```

`Extension/` is the only place code lives. `scripts/build-safari.sh` regenerates the
Xcode wrapper from it on every run, outside the repo, so there is never a second copy
to keep in sync.

## Development

Work on the UI without installing anything:

```bash
python3 -m http.server 8800
```

then open `http://127.0.0.1:8800/preview/panel-demo.html` (the review panel over a
sample article) or `preview/options-demo.html` (the settings page). Both run against
`preview/stub.js`, an in-memory fake of the extension APIs — see
[preview/README.md](preview/README.md).

To try a real change in Safari, edit `Extension/`, re-run `./scripts/build-safari.sh`,
then Safari ▸ Develop ▸ Web Extension Background Pages to reload.

Architecture and the message protocol between the panel and the worker:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Privacy

Article text goes to exactly one place: the OpenRouter model you chose. The API key
never leaves your Mac except in the `Authorization` header to openrouter.ai, and it is
never handed to a content script. Cards go to Anki on `127.0.0.1`. There is no
telemetry and no server of ours.

Safari lists the extension as able to read every site. That is a declaration Safari
requires — it has no per-site grant for `activeTab` extensions — not what the code
does: no content script is declared, and injection happens only when you press the
button. [PRIVACY.md](PRIVACY.md) has the details.

## Chrome and Firefox

The extension is plain MV3 and has no Safari-specific code — `Extension/` loads
unpacked in Chrome (chrome://extensions ▸ Load unpacked) and in Firefox via
`about:debugging`. Only the packaging script is Safari-specific.

## Licence

MIT — see [LICENSE](LICENSE).
