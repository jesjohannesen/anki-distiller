# The prompt

The extension is a thin wrapper around one prompt. Everything else — extraction, the
panel, AnkiConnect — is plumbing. This is where a useful deck and a useless one part
ways.

The full text is `BUILTIN_SYSTEM_PROMPT` in
[`Extension/lib/prompt.js`](../Extension/lib/prompt.js). This document is why it says
what it says.

## The failure mode it's built against

Ask a model for "flashcards from this article" and you reliably get cards like:

> **Front:** What does the author argue about container shipping?
> **Back:** That standardisation, not ship size, drove the cost collapse.

Reviewed six months later this is worthless. It tests recall of *a document*, not of
an idea. You can't answer it without remembering which article it came from, and by
then you don't. Anki punishes this hard: cards you can't answer from first principles
become cards you fail, then cards you suspend, then a deck you stop opening.

Almost every rule in the prompt exists to prevent some version of that.

## The rules and their reasons

**"A reader who has never seen the article must be able to answer it."**
The single load-bearing rule. It rules out "the author", "this study", "as discussed",
and forces context into the card itself. The above becomes:

> **Front:** What made containerisation cut freight costs, rather than larger ships alone?
> **Back:** Standardised box dimensions let cargo move between ship, rail and truck
> without being unpacked, collapsing the port labour costs that dominated the total.

**"General takeaways over article trivia. Mechanisms and causes over isolated facts."**
The thing worth remembering from a good article is usually a *why*, and a why
transfers to material the article never mentioned. Facts without mechanism are what
you'd look up rather than memorise.

**"One idea per card."** Anki's scheduler assumes a card is one recall event. A card
testing two things fails when you know one of them, and the interval resets for both.

**"Front ≤ 20 words, back ≤ 45 words, no restating the question, no hedging."**
Left alone, models write essays on the back. Long backs are ambiguous to grade — did
you recall it or nearly recall it? — and ambiguous grading is what makes a deck feel
arbitrary. The limits are deliberately tight.

**"Avoid yes/no questions and answers that are a list of more than three items."**
Yes/no cards are answerable by guessing. Long lists are one card doing the work of
five and should be split or dropped.

**"Return only as many cards as the article supports. Never pad."**
The most common way an automated deck degrades: asking for eight cards from an article
containing three ideas produces five filler cards, and filler is what teaches you to
stop trusting the deck. The card-count setting is explicitly framed as an aim, not a
quota, and "let the model decide" is offered as a first-class option.

**"Skip: bylines, navigation, marketing, related-links teasers."**
Extraction isn't perfect and some page furniture survives into the text. Naming it in
the prompt is cheaper than making the extractor perfect.

**"If the page holds no article worth carding, return zero cards and say why."**
Index pages, paywall stubs and login screens should produce an honest empty result,
not four invented cards. The panel renders the summary as the explanation.

**Ordering: most important takeaway first.** You review the list top-down and the
first card is the one you'd keep if you kept only one.

## Output format

```json
{"summary": "one sentence naming what the article is about",
 "cards": [{"front": "...", "back": "...", "tag": "kebab-topic"}]}
```

JSON, not a schema-constrained call. `response_format: {type: "json_schema"}` isn't
supported uniformly across OpenRouter's ~400 models, so `parseCards` is tolerant
instead: it tries a clean parse, then a fenced block, then the outermost balanced
braces, then normalises whitespace, accepts `question`/`answer` as aliases for
`front`/`back`, drops entries missing either side, and de-duplicates on the question
text. That's cheaper than restricting the model list.

## Changing it

Settings ▸ Advanced ▸ **Custom system prompt**. **Load the built-in prompt to edit**
drops the current text in so you can adjust rather than start from scratch. An
override replaces the built-in prompt entirely — it must still ask for the JSON shape
above or `parseCards` will throw.

Things that respond well to editing:

- **Cloze cards.** The `Basic` note type is a Distiller default, not a constraint. Set
  the note type to `Cloze` in the Anki section, then rewrite the prompt to emit
  `{{c1::…}}` markup in the front field and leave the back empty.
- **A subject you read constantly.** "This reader has a graduate background in
  macroeconomics; do not card standard undergraduate definitions" kills a whole class
  of cards you'd otherwise delete by hand every time.
- **A house style.** Question phrasing, whether to allow proper nouns on the front,
  whether numbers are ever card-worthy.

The per-run **focus** field in the panel is the lighter-weight version of the same
thing, appended to the user message rather than replacing the system prompt. Reach for
the override only when you find yourself typing the same focus every day.
