# Cost tracking

Off by default, because for most models the honest answer is "this is too cheap to
think about" and a price tag on every run is just noise. Switch it on when you want to
know.

## Turning it on

Distiller settings ▸ **Advanced** ▸ **Track and show costs**.

That does two things:

- a **Spending** panel appears in settings — totals for today, the last 30 days and all
  time, a per-model breakdown, and the last 25 runs;
- a line appears under the cards in the panel:
  `$0.0182 · 4,210 in / 980 out · Claude Sonnet 5`.

Runs are recorded to the local ledger **whether or not the display is on**. So
switching it on shows the history you already have rather than starting from zero.
Nothing about that recording leaves your Mac, and **Clear history** deletes it for
real.

## What a run costs

A 2,000-word article is roughly 2,700 input tokens; eight cards is roughly 900 output
tokens. At list prices:

| Model | In / M | Out / M | ≈ per article |
| --- | --- | --- | --- |
| `deepseek/deepseek-v4-flash` | $0.14 | $0.28 | $0.0006 |
| `openai/gpt-5.6-luna` | $0.10 | $0.60 | $0.0008 |
| `google/gemini-3.5-flash-lite` | $0.30 | $2.50 | $0.003 |
| `anthropic/claude-sonnet-5` | $2.00 | $10.00 | $0.014 |
| `x-ai/grok-4.5` | $2.00 | $6.00 | $0.011 |
| `openai/gpt-5.6-terra` | $1.00 | $6.00 | $0.008 |
| `anthropic/claude-opus-5` | $5.00 | $25.00 | $0.036 |

Prices as listed on OpenRouter in August 2026 and they move; the settings page fetches
the live catalogue and shows the real figure under the model field, refreshed daily.

Practically: reading five articles a day on Claude Sonnet 5 is about **$1 a week**. On
GPT-5.6 Luna it's about six cents. Long articles cost more — the input scales with
length, the output doesn't — and a 10,000-word essay runs roughly four times a short
one. `maxArticleChars` (default 48,000 ≈ 12k tokens) is the ceiling.

## Where the number comes from

Distiller sends `usage: {include: true}` with every request, which makes OpenRouter
return the amount it actually charged, including any provider-specific discounts or
cache hits. That's the number you see.

When a provider doesn't report it, Distiller computes `tokens × catalogue price`
instead and marks the entry with an asterisk (`$0.0038*`), with a footnote under the
table. An estimate is never presented as a charge.

Either way, **OpenRouter's own activity page is the authoritative record.** This
ledger is a convenience, not an accounting system: it can't see spend from other
tools sharing the key, and it records nothing if the call fails before OpenRouter
bills it.

## Keeping the bill down

- **Pick a cheaper model per article.** The panel's model picker is per-run and
  remembers your choice. Flash-class models write perfectly good cards from a clearly
  argued article; the expensive ones earn their price on dense or technical material.
- **Lower `maxArticleChars`** in Advanced if you mostly read long pieces and only want
  the first half carded.
- **Select the section you care about** before pressing the button. A selection over
  400 characters is used instead of the whole article, which cuts input tokens
  proportionally.
- **Set a spend limit on the key itself** at
  [openrouter.ai/keys](https://openrouter.ai/keys). A hard cap at the provider is
  worth more than any client-side guard.

## Exporting

**Export CSV** writes one row per run:

```
timestamp,model,prompt_tokens,completion_tokens,cost_usd,cards,title,url
```

The ledger keeps the most recent `ledgerLimit` runs (default 500) and drops the oldest
beyond that.
