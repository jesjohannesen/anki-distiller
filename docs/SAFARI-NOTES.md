# Safari notes

Five things broke between "this extension works" and "this extension works *in
Safari*". Each produced the same symptom — pressing the toolbar button did nothing,
silently — and each had to be eliminated before the next became visible. They are
written down because none of them is discoverable from the symptom.

## 1. `tabs.sendMessage` resolves when nothing is listening

The one that actually kept the button dead.

```js
// WRONG — this is a Chrome idiom
try {
  await browser.tabs.sendMessage(tabId, { type: 'ping' });
  return;                       // "a content script is already there"
} catch {
  await browser.scripting.executeScript({ target: { tabId }, files });
}
```

Chrome rejects with *"Could not establish connection. Receiving end does not
exist."* **Safari resolves.** So the probe always reports success, the injection
branch is never taken, and nothing is ever injected on any page.

Inject unconditionally and have the content script send back an explicit
acknowledgement. Treat a missing ack as failure — silence is not success.

## 2. `tab.url` is withheld without the `tabs` permission

`action.onClicked` hands you a tab object whose `url` is `undefined` unless the
extension holds `tabs`. Chrome populates it under `activeTab`. Any guard like
`if (!/^https?:/.test(tab.url || '')) return;` silently refuses every page.

## 3. `activeTab` gives the user nothing to grant

Safari never surfaces `activeTab` as a website permission. With host permissions
declared only for your API host, Safari ▸ Settings ▸ Websites ▸ *your extension*
lists that one host and offers **no control for anything else** — so there is no way
to let the extension touch the page being read, and `executeScript` fails everywhere.

Declaring `http://*/*` and `https://*/*` is what makes the "All other websites"
control exist. It widens what Safari *displays* to the user, so say plainly in your
privacy documentation what the code actually does.

## 4. Safari may not start the MV3 service worker

Develop ▸ Web Extension Background Content lists the extension and reports it as
**"not loaded"**, and a toolbar click does not start it. No background, no
`action.onClicked` listener, no anything.

A background page is loaded directly rather than started on demand:

```json
"background": { "scripts": ["lib/a.js", "lib/b.js", "background.js"] }
```

Chrome MV3 rejects `background.scripts`, so keep `service_worker` in the source
manifest and rewrite it at packaging time (see `scripts/build-safari.sh`). Write
`background.js` to work under both — call `importScripts` only when the libraries
are not already defined.

## 5. Safari blocks extensions over stale Launch Services records

Safari resolves an extension through its containing app's LS record. Replace the
installed app while Safari is running — `rm -rf` then copy, which is what a rebuild
does — and a record is left behind pointing at something that no longer exists.
Safari then logs:

```
Couldn't find LSApplicationRecord for … → Disabling and blocking extension with identifier: …
```

**Blocked is sticky.** Nothing you fix afterwards takes effect, and the extension
comes back *unticked* in Settings ▸ Extensions. Nine records had accumulated here —
purged caches, deleted build directories, three Trashed copies.

Unregister the stale ones, register exactly one, and re-enable the extension by hand:

```bash
lsregister -u <stale path>
lsregister -f -R -trusted /Applications/YourApp.app
```

## Debugging technique

Safari's own preferences are TCC-protected, so no script can read whether an
extension is enabled. The unified log is readable and carries the reasons:

```bash
/usr/bin/log show --last 30m --info --debug --style compact \
  --predicate 'subsystem == "com.apple.Safari" AND category == "Extensions"'
```

Use the absolute path: `zsh` has a `log` builtin that swallows the command and
returns nothing, which reads exactly like "no events" and is a good way to reach a
confident wrong conclusion.

Read the line *before* the failure, not the failure itself. "Disabling and blocking
extension" says nothing; "Couldn't find LSApplicationRecord" immediately above it is
the whole answer.

And do not build a diagnostic on an API you have not verified renders. A badge that
Safari silently declines to draw is indistinguishable from a handler that never ran.
Log to the background console, or write to storage and read it back from a page you
control.
