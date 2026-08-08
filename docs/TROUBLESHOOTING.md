# Troubleshooting

## The extension

**Distiller isn't in Safari ▸ Settings ▸ Extensions.**
The app has to be launched at least once from where it will live. Copy it to
`/Applications` and open it. If it still doesn't appear, it's the ad-hoc signature:
Safari ▸ Settings ▸ Advanced ▸ Show features for web developers, then Develop ▸ Allow
Unsigned Extensions. That switch resets on every Safari restart — see
[INSTALL.md](INSTALL.md#if-distiller-doesnt-appear-in-the-list) for how to sign
properly with a free Apple ID.

**The button does nothing.**
Distiller only injects into `http`/`https` pages, so it is a no-op on `about:blank`,
PDFs and Safari's own pages. Otherwise it's the site permission: Safari ▸ Settings ▸
Extensions ▸ Distiller ▸ Edit Website Settings, and allow the site.

**"Distiller lost its connection to Safari."**
The service worker was evicted while the panel was open, usually after a rebuild.
Reload the page.

**Changes to `Extension/` don't show up.**
The Safari build carries a copy of the files. Re-run `./scripts/build-safari.sh` and
reload the extension's background page via Develop ▸ Web Extension Background Pages.

## Extraction

**"No article found on this page."**
The page has under 60 words of extractable body text — a paywall stub, an index page,
or a JS-rendered article that hadn't loaded yet. Try **Re-read page**; if the content
is genuinely there, select the passage you want and press the button again. A
selection over 400 characters bypasses extraction entirely.

**It carded the wrong part of the page.**
The scorer picked a sidebar or comment thread. Select the article text and re-run.

**The word count looks far too high.**
Extraction fell back to `document.body.innerText`, meaning the article-body heuristic
found nothing convincing. The cards will still usually be fine, but you're paying for
navigation text — selecting the article is cheaper.

## OpenRouter

**"OpenRouter rejected the API key."**
Wrong or revoked key. Press **Check key** in settings; it reports the key's label and
remaining credit.

**"Not enough OpenRouter credit."**
Top up at [openrouter.ai/credits](https://openrouter.ai/credits).

**"That model id does not exist on OpenRouter."**
Model ids change. Clear the field and pick from the autocomplete, which is fetched
live and cached for a day.

**"The model did not return valid JSON."**
Some small models can't hold the format. Try again — it's often transient — and if it
recurs, switch models. Anything in the curated shortlist handles it reliably.

**"The model returned an empty response (finish_reason: length)."**
It ran out of output budget. Raise **Max output tokens** in Advanced, or ask for fewer
cards.

**Requests take 60+ seconds.**
Long article, slow model, or a provider queue. Lower `maxArticleChars`, or pick a
flash-class model. The Cancel button stops the wait; it does not cancel the upstream
request, so the call may still be billed.

## Anki

**"Anki is not reachable."**
Anki desktop must be running with the AnkiConnect add-on (code `2055492159`)
installed. AnkiConnect listens on `127.0.0.1:8765`; if you changed its port, change
the AnkiConnect address in Advanced to match.

**"AnkiConnect refused this extension."**
Its origin allow-list doesn't include Distiller. Press **Connect to Anki** in settings
and click **Yes** on the dialog that appears *inside Anki* — it's easy to miss behind
the browser window.

**Cards were "skipped as duplicates".**
Anki rejected notes whose question already exists in that deck. That's usually right —
you've carded this article before. Tick **Allow duplicates** in the Anki section to
override.

**"model was not found" / "cannot create note because it is empty".**
The note type or field names in settings don't match your Anki setup. Pick the note
type from the autocomplete, then set the question and answer fields from that note
type's own fields.

**Cards land with visible `<br>` tags after a TSV import.**
Tick **Allow HTML in fields** in Anki's import dialog.

## Costs

**The spending panel is empty after switching it on.**
No runs recorded yet, or the history was cleared. Recording is unconditional and
independent of the display, so past runs should be there.

**A cost has an asterisk.**
The provider didn't report a charged amount and the figure is `tokens × list price`.
[COSTS.md](COSTS.md) explains when this happens.

**The totals don't match my OpenRouter bill.**
They won't, exactly. The ledger only sees calls this extension made, and only ones
that returned successfully. OpenRouter's activity page is authoritative.
