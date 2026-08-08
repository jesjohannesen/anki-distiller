# Privacy

Distiller has no server. There is no account, no telemetry, no analytics, and no
network destination other than the two you configure yourself.

## What leaves your Mac, and when

**Only when you press the button**, and only for the tab you pressed it on:

| Goes to | What | Why |
| --- | --- | --- |
| `openrouter.ai` | The extracted article text, its title and URL, your focus note if you wrote one, and your API key in the `Authorization` header | To generate the cards |
| `openrouter.ai` | The public model catalogue (no key, no page data) | Model names and pricing, cached 24 h |
| `127.0.0.1:8765` | The cards you approved | To add them to Anki on this machine |

That's the complete list. `manifest.json` grants host permissions for exactly those
two origins, so the extension is technically incapable of contacting anywhere else.

OpenRouter forwards your text to the model provider you selected. Their retention and
training policies are theirs, not ours — check them at
[openrouter.ai/docs](https://openrouter.ai/docs) and on your chosen provider's page,
and note that OpenRouter has an account-level setting controlling whether prompts may
be logged.

## What never leaves

- Your API key never enters a web page. The in-page panel is told `{hasKey: true}` and
  nothing more; every call using the key happens in the extension's background worker.
- The cost ledger is a local array in extension storage. It is never transmitted.
  **Clear history** deletes it.
- Your settings, decks, and note types stay on this Mac.

## What is read from pages

Nothing, until you press the toolbar button. The extension uses `activeTab` +
`scripting` rather than a declared content script, so no code runs on any page you
haven't explicitly invoked it on. There is no background page monitoring, no history
access, no cookie or storage access, and no reading of other tabs.

When you do press it, the extractor reads the current document's text and metadata
(title, byline, site name, URL) and hands it to the panel. If you had text selected,
only the selection is used.

## Where data is stored

Everything is in Safari's extension-local storage for this extension:

- the OpenRouter API key
- your model, card, and Anki preferences
- the cost ledger (timestamp, model, token counts, cost, card count, article title and
  URL — the last 500 runs)

Removing the extension removes all of it. Disabling it does not.

## Cards in Anki

Saved cards contain the question, the answer, tags (`distiller`, the site's domain,
and the model's topic tag, plus any you configured), and — if **Put a link back to the
source** is on — the article URL and title on the back. From there they follow your
own Anki sync arrangement; Distiller has no involvement in it.
