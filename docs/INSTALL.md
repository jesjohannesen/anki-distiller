# Install

Three things have to be in place: the extension in Safari, an OpenRouter key, and
AnkiConnect in Anki. Twenty minutes the first time, and only the first time.

---

## 1. Build and enable the extension

Requires Xcode (or the Xcode command line tools with a full Xcode install — the
converter ships with Xcode itself, not the CLT package).

```bash
git clone https://github.com/jesjohannesen/anki-distiller.git
cd anki-distiller
./scripts/build-safari.sh --open
```

The script wraps `Extension/` in a Safari app extension, builds it, and (with
`--open`) launches the resulting app once so Safari registers it. It prints where the
`.app` ended up.

> The build happens in `~/Library/Caches/com.jesjohannesen.distiller`, not in the
> repo. If the repo lives in iCloud Drive, every file carries a `com.apple.FinderInfo`
> extended attribute and `codesign` refuses to sign the bundle. Building outside the
> synced folder sidesteps it. Override with `DISTILLER_BUILD_DIR=/some/path`.

Then:

1. **Safari ▸ Settings ▸ Extensions** and tick **Distiller**.
2. Click **Edit Website Settings…** (or the "Always Allow on Every Website" prompt the
   first time you press the button) and grant access to the sites you read on.
   Distiller only reads a page when you press its button, but Safari's permission
   model still asks up front.

### If Distiller doesn't appear in the list

Almost certainly code signing. With no Apple developer identity on the machine the
app is ad-hoc signed, and Safari refuses ad-hoc signed extensions unless you tell it
otherwise:

1. **Safari ▸ Settings ▸ Advanced** ▸ tick **Show features for web developers**.
2. **Develop ▸ Allow Unsigned Extensions.**

macOS resets that switch every time Safari restarts. To make it stick, sign properly:
open Xcode ▸ Settings ▸ Accounts, add your Apple ID (a free one is enough for a
personal team), find your team id, then:

```bash
DISTILLER_TEAM_ID=ABCDE12345 ./scripts/build-safari.sh --open
```

### Keep the app somewhere permanent

Safari registers the extension from wherever the `.app` sits. Copy it to
`/Applications` and run it once from there, or Safari will lose the extension the next
time the build cache is cleared:

```bash
cp -R ~/Library/Caches/com.jesjohannesen.distiller/Distiller.app /Applications/
open /Applications/Distiller.app
```

---

## 2. Add an OpenRouter key

1. Create a key at [openrouter.ai/keys](https://openrouter.ai/keys) and put some
   credit on the account (a few dollars lasts a long time — see
   [COSTS.md](COSTS.md)).
2. Open Distiller's settings: press the toolbar button, then the gear icon in the
   panel. (Or Safari ▸ Settings ▸ Extensions ▸ Distiller ▸ Preferences.)
3. Paste the key and press **Check key**. It should report the label and the credit
   remaining.
4. Pick a model. The chips are a sensible shortlist; the text field searches the full
   catalogue and shows live per-million pricing and a rough per-article estimate.

You can set a per-key spend limit on OpenRouter itself, which is a better safety net
than anything an extension can enforce.

---

## 3. Connect Anki

Cards are pushed into Anki desktop through the **AnkiConnect** add-on.

1. In Anki: **Tools ▸ Add-ons ▸ Get Add-ons…**, paste `2055492159`, restart Anki.
2. Leave Anki running.
3. In Distiller settings, press **Connect to Anki**. A dialog appears *inside Anki*
   asking whether to allow the extension — click **Yes**. This writes the extension's
   origin into AnkiConnect's allow-list permanently.
4. The status line should read "Connected to Anki (AnkiConnect v6) · N decks", and the
   deck and note type fields will autocomplete.

Set the default deck and note type you want. The defaults assume Anki's stock `Basic`
note type with `Front` and `Back` fields; if you use a custom note type, pick it and
then choose which of its fields holds the question and the answer.

**Anki must be open when you save cards.** If it isn't, the panel notices and offers a
TSV instead — `Download .txt`, then in Anki **File ▸ Import**, set the field separator
to Tab, map the three columns to Front / Back / Tags, and tick "Allow HTML in fields"
so the line breaks and source links render.

---

## Updating

```bash
git pull
./scripts/build-safari.sh --open
```

Your settings and cost history live in Safari's extension storage and survive
rebuilds.

## Uninstalling

Untick the extension in Safari ▸ Settings ▸ Extensions and delete the app. To also
remove the stored key and cost history, remove the extension entirely rather than just
disabling it. In Anki, AnkiConnect's `webCorsOriginList` will still hold the
extension's origin — harmless, but you can clear it in the add-on's config.
