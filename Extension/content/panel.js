/* In-page review panel.

   Lives in a shadow root pinned to the right edge. It reads the page, shows the
   generated cards for editing, and hands the final set to the background worker.
   It never touches the API key — every network call goes through runtime messaging. */

(() => {
  const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;
  const HOST_ID = 'distiller-panel-host';

  /* Already injected. Do NOT open here: the background worker injects on every click
     and then sends `panel:open`, which the listener registered below already handles.
     Opening here as well would open the panel and immediately toggle it shut. */
  if (window.__distillerPanel) return;

  /* ---------- tiny DOM helper (no innerHTML for model or page text) ---------- */

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v; // only ever used with literal SVG below
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  const ICON = {
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m20 6-11 11-5-5"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 3l18 18M10.6 10.7a3 3 0 0 0 4.2 4.2M9.4 5.3A9.6 9.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.2 6.3A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 3.3-.6"/></svg>',
  };

  const icon = (name) => h('span', { class: 'ico', html: ICON[name] });

  /* ---------- messaging ---------- */

  async function send(type, payload) {
    let res;
    try {
      res = await api.runtime.sendMessage({ type, payload });
    } catch {
      throw new Error('Distiller lost its connection to Safari. Reload the page and try again.');
    }
    if (!res) throw new Error('Distiller got no response from its background process.');
    if (!res.ok) {
      const e = new Error(res.error.message);
      e.kind = res.error.kind;
      throw e;
    }
    return res.data;
  }

  /* ---------- state ---------- */

  const state = {
    view: 'setup',      // setup | loading | cards | done | error
    settings: null,
    article: null,
    summary: '',
    cards: [],
    model: '',
    usage: null,
    decks: null,        // null = unknown, [] = Anki unreachable
    deck: '',
    ankiError: null,
    error: null,
    focus: '',
    focusOpen: false,
    busy: false,
    addedCount: 0,
    elapsed: 0,
  };

  let root = null;      // shadow root
  let wrap = null;      // .wrap
  let bodyEl = null;
  let footEl = null;
  let headTitleEl = null;
  let headSubEl = null;
  let elapsedTimer = null;
  /* Bumped on cancel and on close. A distillation whose token is stale drops its
     result instead of yanking the user back to a view they left. */
  let runToken = 0;

  /* ---------- mount ---------- */

  async function mount() {
    const host = h('div', { id: HOST_ID });
    // A page's own layout must not reflow around us.
    host.style.cssText = 'all:initial;position:fixed;top:0;right:0;z-index:2147483647;';
    document.documentElement.append(host);
    root = host.attachShadow({ mode: 'open' });

    const cssUrl = api.runtime.getURL('content/panel.css');
    const css = await fetch(cssUrl).then((r) => r.text()).catch(() => '');
    root.append(h('style', { text: css }));

    wrap = h('div', { class: 'wrap' });
    const panel = h('div', { class: 'panel' });

    headTitleEl = h('div', { class: 'head-title' });
    headSubEl = h('div', { class: 'head-sub' });

    const head = h('div', { class: 'head' },
      h('div', { class: 'mark', text: 'D' }),
      h('div', { class: 'head-text' }, headTitleEl, headSubEl),
      h('div', { class: 'head-actions' },
        h('button', { class: 'icon-btn', title: 'Settings', onclick: () => send('options:open').catch(() => {}) }, icon('gear')),
        h('button', { class: 'icon-btn', title: 'Close (Esc)', onclick: close }, icon('close')),
      ),
    );

    bodyEl = h('div', { class: 'body' });
    footEl = h('div', { class: 'foot' });

    panel.append(head, bodyEl, footEl);
    wrap.append(panel);
    root.append(wrap);

    document.addEventListener('keydown', onKeydown, true);

    /* Reveal on the next frame so the entry transition runs. requestAnimationFrame
       does not fire in a backgrounded tab, which would leave the panel mounted at
       opacity 0 — so back it with a timer. Both paths are idempotent. */
    const reveal = () => wrap?.classList.add('in');
    requestAnimationFrame(reveal);
    setTimeout(reveal, 60);
  }

  function onKeydown(e) {
    if (!wrap || wrap.classList.contains('gone')) return;
    if (e.key === 'Escape') { close(); e.stopPropagation(); }
  }

  function close() {
    if (!wrap) return;
    const host = document.getElementById(HOST_ID);
    // Rename immediately so a second button press during the exit animation opens a
    // fresh panel instead of adopting the one being torn down.
    if (host) host.id = `${HOST_ID}-closing`;

    const leaving = wrap;
    root = wrap = bodyEl = footEl = null;
    window.__distillerPanel.mounted = false;
    document.removeEventListener('keydown', onKeydown, true);
    clearInterval(elapsedTimer);
    runToken += 1; // abandon any in-flight distillation

    leaving.classList.remove('in');
    setTimeout(() => host?.remove(), 220);
  }

  /* ---------- helpers ---------- */

  const nf = new Intl.NumberFormat();

  function money(v) {
    if (v === null || v === undefined) return '—';
    if (v === 0) return '$0.00';
    if (v < 0.01) return `$${v.toFixed(4)}`;
    return `$${v.toFixed(2)}`;
  }

  function toast(message) {
    if (!root) return;
    const el = h('div', { class: 'toast', text: message });
    root.querySelector('.panel').append(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); }, 1900);
  }

  /* Rough but honest: ~4 characters per token across the models we offer. */
  function approxTokens(text) {
    const t = Math.round((text || '').length / 4);
    return t >= 1000 ? `${(t / 1000).toFixed(1)}k` : String(t);
  }

  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }

  const CURATED = [
    { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5', hint: 'balanced' },
    { id: 'anthropic/claude-opus-5', label: 'Claude Opus 5', hint: 'best quality' },
    { id: 'openai/gpt-5.6-terra', label: 'GPT-5.6 Terra', hint: '' },
    { id: 'openai/gpt-5.6-luna', label: 'GPT-5.6 Luna', hint: 'cheap' },
    { id: 'google/gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite', hint: 'cheap' },
    { id: 'x-ai/grok-4.5', label: 'Grok 4.5', hint: '' },
    { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash', hint: 'cheapest' },
  ];

  function modelLabel(id) {
    return CURATED.find((m) => m.id === id)?.label || id;
  }

  function selectedCards() {
    return state.cards.filter((c) => c.include !== false);
  }

  function toTsv(cards) {
    const clean = (s) => String(s).replace(/\t/g, ' ').replace(/\r?\n/g, '<br>');
    return cards.map((c) => [clean(c.front), clean(c.back), (c.tags || []).join(' ')].join('\t')).join('\n');
  }

  /* ---------- rendering ---------- */

  function render() {
    if (!bodyEl) return;
    bodyEl.replaceChildren();
    footEl.replaceChildren();

    const a = state.article;
    headTitleEl.textContent = a?.title || 'Distiller';
    headSubEl.textContent = a
      ? `${a.siteName || ''}${a.siteName ? ' · ' : ''}${nf.format(a.wordCount)} words${a.source === 'selection' ? ' · selection' : ''}`
      : 'Reading the page…';

    ({ setup: renderSetup, loading: renderLoading, cards: renderCards, done: renderDone, error: renderError }[state.view] || renderSetup)();
  }

  function renderSetup() {
    const s = state.settings;
    const a = state.article;

    if (!s?.hasKey) {
      bodyEl.append(notice({
        title: 'Add an OpenRouter key to begin',
        body: 'Distiller sends the article to the model you pick on OpenRouter. Create a key at openrouter.ai/keys, then paste it into settings.',
        actions: [['Open settings', () => send('options:open').catch(() => {}), 'btn-primary']],
      }));
      return;
    }

    if (!a || a.wordCount < 60) {
      bodyEl.append(notice({
        title: 'No article found on this page',
        body: 'Distiller could not find enough body text here. Try an article page, or select the passage you want and press the button again.',
        actions: [['Re-read page', () => { readArticle().then(render); }, 'btn-ghost']],
      }));
      return;
    }

    // model — the curated shortlist, plus whatever was chosen in settings
    const curated = CURATED.map((m) => ({ id: m.id, label: m.hint ? `${m.label} — ${m.hint}` : m.label }));
    if (!curated.some((m) => m.id === s.model)) {
      curated.unshift({ id: s.model, label: `${s.model} — from settings` });
    }

    const modelSel = h('select', {
      onchange: (e) => { state.settings.model = e.target.value; send('settings:set', { patch: { model: e.target.value } }).catch(() => {}); },
    }, curated.map((m) => h('option', { value: m.id, selected: m.id === s.model, text: m.label })));

    const countSel = h('select', {
      onchange: (e) => {
        const v = Number(e.target.value);
        state.settings.targetCards = v;
        send('settings:set', { patch: { targetCards: v } }).catch(() => {});
      },
    }, [0, 4, 6, 8, 10, 12, 16].map((n) => h('option', {
      value: n, selected: n === s.targetCards, text: n === 0 ? 'Let the model decide' : `About ${n} cards`,
    })));

    const focusBox = h('textarea', {
      rows: 2,
      placeholder: 'e.g. focus on the mechanisms, skip the policy history',
      class: state.focusOpen ? '' : 'hidden',
      value: state.focus,
      oninput: (e) => { state.focus = e.target.value; },
    });

    const focusToggle = h('button', {
      class: `linkish ${state.focusOpen ? 'hidden' : ''}`,
      text: 'Add a focus for this article',
      onclick: () => { state.focusOpen = true; focusToggle.classList.add('hidden'); focusBox.classList.remove('hidden'); focusBox.focus(); },
    });

    bodyEl.append(
      h('div', { class: 'field' }, h('label', { text: 'Model' }), modelSel),
      h('div', { class: 'field' }, h('label', { text: 'How many cards' }), countSel),
      h('div', { class: 'field' }, focusToggle, focusBox),
      h('div', { class: 'stat-strip' },
        h('span', { text: `${nf.format(a.wordCount)} words` }),
        h('span', { class: 'dot' }),
        h('span', { text: `≈${approxTokens(a.text)} tokens in` }),
      ),
    );

    footEl.append(h('button', {
      class: 'btn btn-primary btn-wide',
      text: a.source === 'selection' ? 'Distil selection' : 'Distil article',
      onclick: runDistil,
    }));
  }

  function renderLoading() {
    const sk = h('div', { class: 'skeleton' });
    for (let i = 0; i < 3; i += 1) {
      sk.append(h('div', { class: 'sk-card' },
        h('div', { class: 'sk-bar', style: 'width:72%' }),
        h('div', { class: 'sk-bar', style: 'width:100%' }),
        h('div', { class: 'sk-bar', style: 'width:88%' }),
      ));
    }
    const note = h('div', { class: 'loading-note', text: `Reading with ${modelLabel(state.settings.model)}…` });
    bodyEl.append(note, sk);

    clearInterval(elapsedTimer);
    state.elapsed = 0;
    elapsedTimer = setInterval(() => {
      state.elapsed += 1;
      if (state.elapsed > 3) note.textContent = `Reading with ${modelLabel(state.settings.model)}… ${state.elapsed}s`;
    }, 1000);

    footEl.append(h('button', {
      class: 'btn btn-ghost btn-wide',
      text: 'Cancel',
      onclick: () => {
        runToken += 1;
        clearInterval(elapsedTimer);
        state.view = 'setup';
        render();
      },
    }));
  }

  function renderCards() {
    if (!state.cards.length) {
      bodyEl.append(h('div', { class: 'empty' }, state.summary || 'The model found nothing worth carding on this page.'));
      footEl.append(h('button', { class: 'btn btn-ghost btn-wide', text: 'Try again', onclick: () => { state.view = 'setup'; render(); } }));
      return;
    }

    if (state.summary) bodyEl.append(h('div', { class: 'summary', text: state.summary }));

    state.cards.forEach((card, i) => {
      const el = h('div', { class: `card ${card.include === false ? 'off' : ''}`, style: `animation-delay:${Math.min(i * 35, 350)}ms` });

      const front = h('textarea', {
        class: 'card-edit card-front', rows: 1, value: card.front,
        oninput: (e) => { card.front = e.target.value; autoGrow(e.target); },
      });
      const back = h('textarea', {
        class: 'card-edit card-back', rows: 1, value: card.back,
        oninput: (e) => { card.back = e.target.value; autoGrow(e.target); },
      });

      const toggle = h('button', {
        class: 'icon-btn', title: card.include === false ? 'Include this card' : 'Skip this card',
        onclick: () => { card.include = card.include === false; render(); },
      }, icon(card.include === false ? 'eyeOff' : 'eye'));

      const del = h('button', {
        class: 'icon-btn', title: 'Delete',
        onclick: () => { state.cards.splice(i, 1); render(); },
      }, icon('trash'));

      el.append(
        h('div', { class: 'card-top' },
          h('span', { class: 'card-n', text: String(i + 1).padStart(2, '0') }),
          card.tag ? h('span', { class: 'chip', text: card.tag }) : null,
          h('span', { class: 'spacer' }),
          toggle, del,
        ),
        front,
        h('div', { class: 'card-rule' }),
        back,
      );

      bodyEl.append(el);
      requestAnimationFrame(() => { autoGrow(front); autoGrow(back); });
    });

    // footer: deck + save
    const n = selectedCards().length;

    if (state.decks === null) {
      footEl.append(h('div', { class: 'foot-row' },
        h('button', { class: 'btn btn-ghost btn-wide', disabled: true }, h('span', { class: 'spinner' }), 'Looking for Anki…'),
      ));
    } else if (state.decks.length) {
      const deckSel = h('select', { onchange: (e) => { state.deck = e.target.value; } },
        state.decks.map((d) => h('option', { value: d, selected: d === state.deck, text: d })));
      footEl.append(
        h('div', { class: 'foot-row' },
          deckSel,
          h('button', {
            class: 'btn btn-primary', disabled: n === 0 || state.busy, onclick: addToAnki,
          }, state.busy ? h('span', { class: 'spinner' }) : null, state.busy ? 'Adding' : `Add ${n}`),
        ),
        h('div', { class: 'foot-row' },
          h('button', { class: 'btn btn-ghost', text: 'Copy TSV', onclick: copyTsv }),
          h('button', { class: 'btn btn-ghost', text: 'Download .txt', onclick: downloadTsv }),
        ),
      );
    } else {
      // No Anki: the export path is the primary action, not a consolation prize.
      footEl.append(
        h('div', { class: 'cost-line', text: state.ankiError || 'Anki is not reachable — export instead.' }),
        h('div', { class: 'foot-row' },
          h('button', { class: 'btn btn-ghost', text: 'Retry Anki', onclick: loadDecks }),
          h('button', { class: 'btn btn-primary', text: `Download ${n}`, disabled: n === 0, onclick: downloadTsv }),
        ),
        h('div', { class: 'foot-row' },
          h('button', { class: 'btn btn-ghost btn-wide', text: 'Copy TSV to clipboard', onclick: copyTsv }),
        ),
      );
    }

    if (state.usage) {
      const u = state.usage;
      footEl.append(h('div', {
        class: 'cost-line',
        text: `${money(u.cost)}${u.costIsEstimate ? ' est.' : ''} · ${nf.format(u.promptTokens)} in / ${nf.format(u.completionTokens)} out · ${modelLabel(state.model)}`,
      }));
    }
  }

  function renderDone() {
    bodyEl.append(h('div', { class: 'done' },
      h('div', { class: 'tick', html: ICON.check }),
      h('h3', { text: `${state.addedCount} card${state.addedCount === 1 ? '' : 's'} added` }),
      h('p', { text: `Saved to “${state.deck}”. They'll sync to your other devices next time Anki syncs.` }),
    ));
    footEl.append(h('div', { class: 'foot-row' },
      h('button', { class: 'btn btn-ghost', text: 'Distil again', onclick: () => { state.view = 'setup'; render(); } }),
      h('button', { class: 'btn btn-primary', text: 'Done', onclick: close }),
    ));
  }

  function renderError() {
    bodyEl.append(notice({
      title: 'That did not work',
      body: state.error || 'Unknown error.',
      error: true,
      actions: [
        ['Try again', () => { state.view = 'setup'; render(); }, 'btn-primary'],
        ['Settings', () => send('options:open').catch(() => {}), 'btn-ghost'],
      ],
    }));
  }

  function notice({ title, body, actions = [], error = false }) {
    return h('div', { class: `notice ${error ? 'error' : ''}` },
      h('strong', { text: title }),
      h('p', { text: body }),
      actions.length
        ? h('div', { class: 'actions' }, actions.map(([label, fn, cls]) => h('button', { class: `btn ${cls}`, text: label, onclick: fn })))
        : null,
    );
  }

  /* ---------- actions ---------- */

  async function readArticle() {
    state.article = window.__distillerExtract ? window.__distillerExtract() : null;
  }

  async function runDistil() {
    const token = ++runToken;
    state.view = 'loading';
    render();
    try {
      const res = await send('distil', {
        article: state.article,
        focus: state.focus,
        model: state.settings.model,
      });
      if (token !== runToken) return; // cancelled or closed while we waited
      clearInterval(elapsedTimer);
      state.summary = res.summary;
      state.cards = res.cards.map((c) => ({ ...c, include: true }));
      state.model = res.model;
      state.usage = res.usage;
      state.decks = null;
      state.view = 'cards';
      render();
      loadDecks();
    } catch (e) {
      if (token !== runToken) return;
      clearInterval(elapsedTimer);
      state.error = e.message;
      state.view = 'error';
      render();
    }
  }

  async function loadDecks() {
    state.decks = null;
    state.ankiError = null;
    if (state.view === 'cards') render();
    try {
      const status = await send('anki:status');
      state.decks = status.decks;
      state.deck = status.decks.includes(state.settings.deck) ? state.settings.deck : status.decks[0];
    } catch (e) {
      state.decks = [];
      state.ankiError = e.kind === 'permission'
        ? 'Anki blocked this extension — run “Connect to Anki” in settings.'
        : 'Anki is not running — export instead.';
    }
    if (state.view === 'cards') render();
  }

  async function addToAnki() {
    const cards = selectedCards();
    if (!cards.length) return;
    state.busy = true;
    render();
    try {
      const res = await send('anki:add', {
        cards: cards.map(({ front, back, tags }) => ({ front, back, tags })),
        deck: state.deck,
        source: { url: state.article.url, title: state.article.title },
      });
      state.addedCount = res.added;
      state.deck = res.deck;
      state.busy = false;
      if (res.skipped > 0 && res.added === 0) {
        toast(`All ${res.skipped} were already in “${res.deck}”`);
        render();
        return;
      }
      if (res.skipped > 0) toast(`${res.skipped} skipped as duplicates`);
      state.view = 'done';
      render();
    } catch (e) {
      state.busy = false;
      state.error = e.message;
      state.view = 'error';
      render();
    }
  }

  async function copyTsv() {
    const cards = selectedCards();
    try {
      await navigator.clipboard.writeText(toTsv(cards));
      toast(`${cards.length} cards copied as TSV`);
    } catch {
      toast('Safari blocked the clipboard — use Download instead');
    }
  }

  function downloadTsv() {
    const cards = selectedCards();
    const blob = new Blob([toTsv(cards)], { type: 'text/tab-separated-values' });
    const url = URL.createObjectURL(blob);
    const name = (state.article.title || 'distiller').replace(/[^\w\s-]/g, '').trim().slice(0, 60).replace(/\s+/g, '-');
    const a = h('a', { href: url, download: `${name || 'distiller'}-anki.txt` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('Saved — import it in Anki with File ▸ Import');
  }

  /* ---------- entry ---------- */

  let opening = false;

  async function open() {
    if (opening) return;
    opening = true;
    try {
      if (!document.getElementById(HOST_ID)) await mount();
      window.__distillerPanel.mounted = true;
      state.settings = await send('ui:bootstrap').catch(() => null);
      if (state.view !== 'cards') {
        await readArticle();
        state.view = 'setup';
      }
      render();
    } finally {
      opening = false;
    }
  }

  window.__distillerPanel = { open, mounted: false };

  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'panel:open') return false;
    // Pressing the toolbar button again while the panel is up closes it.
    if (wrap && wrap.classList.contains('in')) close();
    else open();
    // The worker needs a positive acknowledgement: Safari resolves sendMessage even
    // when nothing is listening, so silence there is indistinguishable from success.
    sendResponse({ ok: true });
    return false;
  });

  /* No self-invocation here: the background worker always sends `panel:open`
     immediately after injecting this file, and doing both would mount twice. */
})();
