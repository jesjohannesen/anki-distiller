/* Background service worker.

   Owns every network call (OpenRouter, AnkiConnect) and all storage. The content
   script is pure UI and page reading; it never sees the API key. */

/* Runs in two shapes:

   - Chrome/Firefox: an MV3 service worker, where the libraries have to be pulled in
     with importScripts.
   - Safari: a non-persistent background *page*, because Safari does not reliably
     start an MV3 service worker for a converted extension — it registered none at
     all, so no click listener ever existed and the button was inert. There the
     manifest lists the libraries as <script> tags (see scripts/build-safari.sh) and
     they are already loaded by the time this file runs.

   So: import only if the libraries are not already present. A throw inside
   importScripts would otherwise abort evaluation of this whole file and leave no
   click listener registered — alive but deaf, logging nothing. */
let BOOT_ERROR = null;
if (typeof getSettings !== 'function') {
  try {
    importScripts(
      'lib/shim.js',
      'lib/settings.js',
      'lib/ledger.js',
      'lib/openrouter.js',
      'lib/anki.js',
      'lib/prompt.js',
    );
  } catch (e) {
    BOOT_ERROR = e;
    console.error('[Distiller] library import failed:', e);
  }
}

/* Resolved without depending on lib/shim.js having loaded. Named `ext` rather than
   `api` because shim.js declares `var api` into this same global scope. */
const ext = globalThis.api ?? globalThis.browser ?? globalThis.chrome;

/* ---------- toolbar button ---------- */

const INJECT_FILES = ['content/extract.js', 'content/panel.js'];

/* Turn an injection failure into something the user can act on: a badge on the
   toolbar button and the reason in its tooltip. A silent no-op is the one outcome
   that leaves nobody anything to debug. */
async function flagProblem(tabId, message) {
  console.error('[Distiller]', message);
  try {
    await ext.action.setBadgeText({ text: '!', tabId });
    await ext.action.setBadgeBackgroundColor({ color: '#c0342b', tabId });
    await ext.action.setTitle({ tabId, title: `Distiller — ${message}` });
  } catch { /* badge APIs are best-effort */ }
}

async function clearProblem(tabId) {
  try {
    await ext.action.setBadgeText({ text: '', tabId });
    await ext.action.setTitle({ tabId, title: 'Distil this article into Anki cards' });
  } catch { /* ignore */ }
}

function explainInjectionFailure(error, tab) {
  const msg = String(error?.message || error);
  if (/permission|not allowed|cannot access|denied|blocked/i.test(msg)) {
    return 'Safari has not granted access to this site. Click the Distiller button and choose "Always Allow on Every Website", or set it in Safari ▸ Settings ▸ Extensions ▸ Distiller.';
  }
  // Injection genuinely cannot work on Safari's own pages or the Extensions gallery.
  const url = tab?.url || '';
  if (url && !/^https?:/i.test(url)) return 'This kind of page cannot be read by extensions. Open an article first.';
  return `Could not start on this page: ${msg}`;
}

async function openPanel(tab) {
  if (!tab?.id) return;

  // Note: we deliberately do NOT gate on tab.url. Safari withholds it unless the
  // extension holds the "tabs" permission, so checking it here silently refused
  // every page. Try the injection and let the failure explain itself instead.
  try {
    await ext.tabs.sendMessage(tab.id, { type: 'panel:open' });
    await clearProblem(tab.id);
    return; // already injected
  } catch {
    // not injected yet — fall through
  }

  try {
    await ext.scripting.executeScript({ target: { tabId: tab.id }, files: INJECT_FILES });
    await ext.tabs.sendMessage(tab.id, { type: 'panel:open' });
    await clearProblem(tab.id);
  } catch (e) {
    await flagProblem(tab.id, explainInjectionFailure(e, tab));
  }
}

ext.action.onClicked.addListener((tab) => {
  /* Acknowledge the press before attempting anything that can fail. If this dot
     never appears on the toolbar button, the worker is not running the handler at
     all — a completely different fault from injection being refused, and worth
     being able to tell apart at a glance. clearProblem() removes it on success. */
  if (tab?.id) {
    try {
      ext.action.setBadgeBackgroundColor({ color: '#5a54e0', tabId: tab.id });
      ext.action.setBadgeText({ text: '•', tabId: tab.id });
    } catch { /* badge APIs are best-effort */ }
  }

  if (BOOT_ERROR) {
    flagProblem(tab?.id, `Distiller failed to start: ${BOOT_ERROR.message || BOOT_ERROR}`);
    return;
  }

  openPanel(tab).catch((e) => flagProblem(tab?.id, `Unexpected error: ${e?.message || e}`));
});

/* ---------- distillation ---------- */

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function tagsFor(article, card, settings) {
  const raw = [
    'distiller',
    domainOf(article.url).replace(/\./g, '-'),
    card.tag,
    ...(settings.extraTags || '').split(','),
  ];
  return [...new Set(raw.map((t) => String(t).trim().replace(/\s+/g, '-')).filter(Boolean))];
}

async function distil({ article, focus, model }) {
  const settings = await getSettings();
  if (!settings.apiKey) {
    const err = new Error('No OpenRouter API key yet. Add one in Distiller settings.');
    err.kind = 'no-key';
    throw err;
  }
  if (!article?.text || article.text.trim().length < 200) {
    const err = new Error("There isn't enough article text on this page to distil.");
    err.kind = 'no-article';
    throw err;
  }

  const chosenModel = model || settings.model;
  const started = Date.now();

  const { content, usage, model: usedModel } = await orChat({
    apiKey: settings.apiKey,
    model: chosenModel,
    system: buildSystemPrompt(settings),
    user: buildUserPrompt(article, settings, focus),
    temperature: settings.temperature,
    maxTokens: settings.maxOutputTokens,
  });

  const { summary, cards } = parseCards(content);
  const enriched = cards.map((c) => ({ ...c, tags: tagsFor(article, c, settings) }));

  await ledgerAppend({
    ts: Date.now(),
    model: usedModel,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    cost: usage.cost,
    costIsEstimate: usage.costIsEstimate,
    cards: enriched.length,
    title: article.title || '',
    url: article.url || '',
    ms: Date.now() - started,
  });

  return {
    summary,
    cards: enriched,
    model: usedModel,
    // Only hand usage to the UI when the user has asked to see costs.
    usage: settings.showCosts ? usage : null,
    elapsedMs: Date.now() - started,
  };
}

/* ---------- message router ---------- */

const handlers = {
  'settings:get': () => getSettings(),
  'settings:set': ({ patch }) => setSettings(patch),

  /* What the in-page panel needs, and nothing more — the API key never crosses
     into a content script. */
  'ui:bootstrap': async () => {
    const s = await getSettings();
    return {
      hasKey: !!s.apiKey,
      model: s.model,
      targetCards: s.targetCards,
      deck: s.deck,
      showCosts: s.showCosts,
    };
  },

  'models:list': ({ force }) => orModels({ force }),
  'key:status': async ({ apiKey }) => {
    const s = await getSettings();
    return orKeyStatus(apiKey || s.apiKey);
  },

  distil,

  'anki:status': async () => {
    const s = await getSettings();
    return ankiStatus(s.ankiUrl);
  },
  'anki:connect': async () => {
    const s = await getSettings();
    await ankiRequestPermission(s.ankiUrl);
    return ankiStatus(s.ankiUrl);
  },
  'anki:fields': async ({ noteType }) => {
    const s = await getSettings();
    return ankiFieldNames(noteType, s.ankiUrl);
  },
  'anki:add': async ({ cards, source, deck }) => {
    const s = await getSettings();
    const targetDeck = deck || s.deck;
    const result = await ankiAddCards(cards, {
      deck: targetDeck,
      noteType: s.noteType,
      frontField: s.frontField,
      backField: s.backField,
      allowDuplicates: s.allowDuplicates,
      source: s.appendSource ? source : null,
      tags: [],
      url: s.ankiUrl,
    });
    if (deck && deck !== s.deck) await setSettings({ deck }); // remember the last deck used
    return { ...result, deck: targetDeck };
  },

  'ledger:summary': () => ledgerSummary(),
  'ledger:all': () => ledgerAll(),
  'ledger:clear': () => ledgerClear(),

  'options:open': async () => { await ext.runtime.openOptionsPage(); return true; },
};

ext.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return false;

  Promise.resolve(handler(msg.payload || msg))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({
      ok: false,
      error: { message: e?.message || String(e), kind: e?.kind || e?.name || 'error' },
    }));

  return true; // keep the channel open for the async reply
});

/* ---------- first run ---------- */

ext.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    await ext.runtime.openOptionsPage();
  }
});
