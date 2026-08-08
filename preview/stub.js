/* Preview-only stub of the WebExtension APIs, so the UI can be rendered in a plain
   browser tab. Not part of the extension. */
(() => {
  const store = {
    apiKey: 'sk-or-v1-preview-key-not-real',
    model: 'anthropic/claude-sonnet-5',
    temperature: 0.3, maxOutputTokens: 4000, maxArticleChars: 48000,
    targetCards: 8, language: 'auto', appendSource: true, extraTags: 'reading, 2026',
    ankiUrl: 'http://127.0.0.1:8765', deck: 'Reading', noteType: 'Basic',
    frontField: 'Front', backField: 'Back', allowDuplicates: false,
    showCosts: true, ledgerLimit: 500, systemPromptOverride: '',
    modelsCache: null, modelsCachedAt: 0,
    lastClick: { ts: Date.now() - 12000, tabId: 3 },
    lastStartFailure: { reason: 'Safari has not granted access to this site.', ts: Date.now() - 12000 },
    costLedger: [
      { ts: Date.now() - 3600e3, model: 'anthropic/claude-sonnet-5', promptTokens: 4210, completionTokens: 980, cost: 0.0182, cards: 8, title: 'The bitter lesson of scaling', url: 'https://example.com/a' },
      { ts: Date.now() - 7200e3, model: 'openai/gpt-5.6-luna', promptTokens: 3100, completionTokens: 720, cost: 0.0007, cards: 6, title: 'Why currency pegs fail', url: 'https://example.com/b' },
      { ts: Date.now() - 86400e3 * 2, model: 'anthropic/claude-sonnet-5', promptTokens: 9800, completionTokens: 1400, cost: 0.0336, cards: 12, title: 'A short history of container shipping', url: 'https://example.com/c' },
      { ts: Date.now() - 86400e3 * 5, model: 'google/gemini-3.5-flash-lite', promptTokens: 5200, completionTokens: 900, cost: 0.0038, costIsEstimate: true, cards: 7, title: 'Protein folding, explained', url: 'https://example.com/d' },
    ],
  };

  const MODELS = [
    { id: 'anthropic/claude-sonnet-5', name: 'Anthropic: Claude Sonnet 5', context: 1000000, promptPrice: 2e-6, completionPrice: 1e-5 },
    { id: 'anthropic/claude-opus-5', name: 'Claude Opus 5', context: 1000000, promptPrice: 5e-6, completionPrice: 2.5e-5 },
    { id: 'openai/gpt-5.6-luna', name: 'OpenAI: GPT-5.6 Luna', context: 1050000, promptPrice: 1e-7, completionPrice: 6e-7 },
    { id: 'google/gemini-3.5-flash-lite', name: 'Google: Gemini 3.5 Flash Lite', context: 1048576, promptPrice: 3e-7, completionPrice: 2.5e-6 },
  ];

  const SAMPLE = {
    summary: 'How container standardisation, not ship size, made global shipping cheap.',
    model: 'anthropic/claude-sonnet-5',
    usage: { promptTokens: 4210, completionTokens: 980, cost: 0.0182, costIsEstimate: false },
    cards: [
      { front: 'What made containerisation cut freight costs, rather than larger ships alone?', back: 'Standardised box dimensions let cargo move between ship, rail and truck without being unpacked, collapsing port labour costs that dominated the total.', tag: 'containerisation', tags: ['distiller', 'example-com', 'containerisation'] },
      { front: 'Why did ports resist container standards despite the cost savings?', back: 'Existing cranes, warehouses and union agreements were built around break-bulk handling; the savings accrued to shippers while the transition costs fell on ports.', tag: 'institutional-inertia', tags: ['distiller', 'example-com', 'institutional-inertia'] },
      { front: 'What determines whether a transport innovation lowers landed cost?', back: 'The share of total cost it removes at the transfer points, not the speed or capacity of the vehicle itself.', tag: 'transport-economics', tags: ['distiller', 'example-com', 'transport-economics'] },
      { front: 'Roughly what share of pre-container freight cost was port handling?', back: 'Somewhere between half and two-thirds, which is why loading efficiency mattered more than sailing speed.', tag: 'freight-costs', tags: ['distiller', 'example-com', 'freight-costs'] },
    ],
  };

  const handlers = {
    'ui:bootstrap': () => ({ hasKey: !!store.apiKey, model: store.model, targetCards: store.targetCards, deck: store.deck, showCosts: store.showCosts }),
    'settings:get': () => ({ ...store }),
    'settings:set': ({ patch }) => { Object.assign(store, patch); return { ...store }; },
    'models:list': () => MODELS,
    'key:status': () => ({ label: 'personal', usage: 4.12, limit: 20, limitRemaining: 15.88, isFreeTier: false }),
    distil: () => new Promise((r) => setTimeout(() => r(SAMPLE), 1400)),
    'anki:status': () => new Promise((r) => setTimeout(() => r({ version: 6, decks: ['Default', 'Reading', 'Reading::Economics', 'Languages::Norwegian'], models: ['Basic', 'Basic (and reversed card)', 'Cloze'] }), 600)),
    'anki:fields': () => ['Front', 'Back'],
    'anki:add': ({ cards, deck }) => new Promise((r) => setTimeout(() => r({ added: cards.length, skipped: 0, deck: deck || store.deck }), 700)),
    'options:open': () => { window.open('options.html', '_blank'); return true; },
  };

  window.browser = {
    runtime: {
      getURL: (p) => `../Extension/${p}`,
      sendMessage: async (msg) => {
        const fn = handlers[msg.type];
        if (!fn) return { ok: false, error: { message: `no stub for ${msg.type}`, kind: 'stub' } };
        try { return { ok: true, data: await fn(msg.payload || {}) }; }
        catch (e) { return { ok: false, error: { message: e.message, kind: 'stub' } }; }
      },
      onMessage: { addListener() {} },
      openOptionsPage: async () => window.open('options.html', '_blank'),
    },
    storage: {
      local: {
        get: async (keys) => {
          const out = {};
          for (const k of (Array.isArray(keys) ? keys : [keys])) if (k in store) out[k] = store[k];
          return out;
        },
        set: async (patch) => { Object.assign(store, patch); },
        remove: async (k) => { delete store[k]; },
      },
    },
  };
})();
