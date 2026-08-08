/* Prompt construction and response parsing.

   The whole product lives or dies here: the difference between a useful deck and a
   useless one is whether the cards test *transferable learnings* or article trivia.
   See docs/PROMPT.md for the reasoning behind each rule. */

const BUILTIN_SYSTEM_PROMPT = `You are a study-card editor. You are given one article and you distil it into a small set of Anki flashcards that capture its transferable learnings — the principles, mechanisms, causal relationships and durable facts a thoughtful reader would want to still know a year from now.

WHAT EARNS A CARD
- General takeaways over article trivia. "Why does a currency peg constrain monetary policy?" earns a card; "What did the author argue in section 3?" does not.
- Mechanisms and causes over isolated facts. If the article explains why something happens, the card should test the why.
- A number, name or date earns a card only when the number itself is the insight, and only with enough context to mean something.
- Ideas the article actually supports. If you are not confident it is in the text, leave it out.

WHAT NEVER EARNS A CARD
- Anything about the article as an object: its author, structure, publication, framing, or what it "argues".
- Navigation text, bylines, marketing copy, calls to action, related-links teasers.
- Definitions of terms the reader must already know to have been reading this article at all.

HOW TO WRITE EACH CARD
- Standalone. A reader who has never seen the article must be able to answer it. Never write "the author", "this study", "according to the article", "as discussed" — if a specific source matters, name it in the text of the card.
- One idea per card. If a takeaway has two independent parts, write two cards.
- FRONT: a precise question or prompt, at most 20 words. It must have one defensible answer. Avoid yes/no questions and avoid questions whose answer is a list of more than three items.
- BACK: the answer compressed to its essential form. One to three sentences, at most 45 words. Do not restate the question, do not hedge, do not add commentary.
- TAG: two to four lowercase words joined by hyphens naming the topic, e.g. "monetary-policy" or "protein-folding".

COUNT
- Return only as many cards as the article genuinely supports. A thin article should yield three cards. Never pad to reach a requested number, and never split one idea across near-duplicate cards to inflate the count.
- Order cards so the most important takeaway comes first.

OUTPUT
Reply with a single JSON object and nothing else — no prose before it, no code fence around it:
{"summary": "one sentence naming what the article is actually about", "cards": [{"front": "...", "back": "...", "tag": "..."}]}
If the page holds no article worth carding (a index page, a paywall stub, a login screen), return {"summary": "...", "cards": []} and say why in the summary.`;

function buildSystemPrompt(settings) {
  const override = (settings.systemPromptOverride || '').trim();
  return override || BUILTIN_SYSTEM_PROMPT;
}

function buildUserPrompt(article, settings, focus) {
  const max = Math.max(2000, settings.maxArticleChars | 0);
  let body = article.text || '';
  let truncated = false;
  if (body.length > max) {
    body = body.slice(0, max);
    truncated = true;
  }

  const directives = [];
  if (settings.targetCards > 0) {
    directives.push(`Aim for about ${settings.targetCards} cards, fewer if the article does not support that many.`);
  } else {
    directives.push('Choose the number of cards yourself, based on how much the article actually contains.');
  }
  if (settings.language && settings.language !== 'auto') {
    directives.push(`Write the cards in ${settings.language}, regardless of the article's language.`);
  } else {
    directives.push("Write the cards in the article's own language.");
  }
  if (focus && focus.trim()) {
    directives.push(`The reader is specifically interested in: ${focus.trim()}. Weight the cards towards that, but do not invent material the article lacks.`);
  }
  if (truncated) {
    directives.push('The article text below was truncated mid-way; card only what is present.');
  }

  const meta = [
    `TITLE: ${article.title || '(unknown)'}`,
    article.byline ? `BYLINE: ${article.byline}` : null,
    article.siteName ? `SITE: ${article.siteName}` : null,
    `URL: ${article.url}`,
  ].filter(Boolean).join('\n');

  return `${meta}

INSTRUCTIONS
${directives.map((d) => `- ${d}`).join('\n')}

ARTICLE
${body}`;
}

/* Models wrap JSON in code fences, prose, or both. Try clean parse, then a fence,
   then the outermost balanced braces. */
function extractJson(raw) {
  const text = String(raw).trim();

  const attempts = [text];

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) attempts.push(fence[1].trim());

  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) attempts.push(text.slice(first, last + 1));

  for (const candidate of attempts) {
    try { return JSON.parse(candidate); } catch { /* next */ }
  }
  throw new Error('The model did not return valid JSON. Try again, or pick a different model.');
}

function cleanText(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

function slugTag(v) {
  const s = String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s.slice(0, 40);
}

/* Normalise, drop malformed cards, and de-duplicate on the front text. */
function parseCards(raw) {
  const data = extractJson(raw);
  const list = Array.isArray(data) ? data : (data.cards || []);
  const seen = new Set();
  const cards = [];

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const front = cleanText(item.front ?? item.question ?? item.q);
    const back = cleanText(item.back ?? item.answer ?? item.a);
    if (!front || !back) continue;

    const key = front.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    cards.push({ front, back, tag: slugTag(item.tag ?? item.topic ?? '') });
  }

  return { summary: cleanText(data.summary || ''), cards };
}

globalThis.BUILTIN_SYSTEM_PROMPT = BUILTIN_SYSTEM_PROMPT;
globalThis.buildSystemPrompt = buildSystemPrompt;
globalThis.buildUserPrompt = buildUserPrompt;
globalThis.parseCards = parseCards;
