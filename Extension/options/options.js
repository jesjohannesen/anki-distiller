/* Settings page.

   Storage reads and writes happen here directly (same extension context); anything
   that touches the network is delegated to the background worker. */

const $ = (id) => document.getElementById(id);

const CURATED = [
  { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'anthropic/claude-opus-5', label: 'Claude Opus 5' },
  { id: 'openai/gpt-5.6-terra', label: 'GPT-5.6 Terra' },
  { id: 'openai/gpt-5.6-luna', label: 'GPT-5.6 Luna' },
  { id: 'google/gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
  { id: 'x-ai/grok-4.5', label: 'Grok 4.5' },
  { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
];

/* Text inputs, number inputs, selects and checkboxes that map 1:1 onto settings keys. */
const BOUND = {
  apiKey: 'value', modelInput: 'value', temperature: 'number', maxOutputTokens: 'number',
  maxArticleChars: 'number', targetCards: 'number', language: 'value', extraTags: 'value',
  appendSource: 'checked', ankiUrl: 'value', deck: 'value', noteType: 'value',
  frontField: 'value', backField: 'value', allowDuplicates: 'checked',
  showCosts: 'checked', systemPromptOverride: 'value',
};

const KEY_OF = { modelInput: 'model' };
const settingKey = (elId) => KEY_OF[elId] || elId;

let models = [];

/* ---------- messaging ---------- */

async function send(type, payload) {
  const res = await api.runtime.sendMessage({ type, payload });
  if (!res) throw new Error('No response from the Distiller background process.');
  if (!res.ok) {
    const e = new Error(res.error.message);
    e.kind = res.error.kind;
    throw e;
  }
  return res.data;
}

function setStatus(el, text, kind) {
  el.textContent = text;
  el.className = `status${kind ? ` ${kind}` : ''}`;
}

let savedTimer;
function flashSaved() {
  setStatus($('saveState'), 'Saved', 'ok');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => setStatus($('saveState'), ''), 1600);
}

/* ---------- load / bind ---------- */

async function load() {
  const s = await getSettings();

  for (const [elId, kind] of Object.entries(BOUND)) {
    const el = $(elId);
    const value = s[settingKey(elId)];
    if (kind === 'checked') el.checked = !!value;
    else el.value = value ?? '';
  }

  renderChips(s.model);
  applyCostVisibility(s.showCosts);
  if (s.showCosts) renderCosts();

  bind();
  loadModels();
  probeAnki({ quiet: true });
  renderDiagnostics();
}

/* Whether the toolbar button reaches the extension at all, answered from storage
   rather than from whether a badge appeared — Safari's badge rendering is not
   something the extension controls, so it is useless as evidence. */
async function renderDiagnostics() {
  const { lastClick, lastStartFailure } = await api.storage.local.get(['lastClick', 'lastStartFailure']);

  const probe = $('clickProbe');
  if (lastClick?.ts) {
    const when = new Date(lastClick.ts);
    const secs = Math.round((Date.now() - lastClick.ts) / 1000);
    const ago = secs < 90 ? `${secs}s ago` : when.toLocaleString();
    probe.textContent = `Toolbar button last reached the extension ${ago}. The click handler is running.`;
  } else {
    probe.textContent = 'The toolbar button has never reached the extension. Either it has not been pressed, or Safari is not delivering the click to it.';
  }

  if (location.hash === '#start-failed' && lastStartFailure?.reason) {
    $('startFailedReason').textContent = lastStartFailure.reason;
    $('startFailed').classList.remove('hidden');
    $('advanced').open = true;
  }
}

function bind() {
  for (const [elId, kind] of Object.entries(BOUND)) {
    const el = $(elId);
    const event = (kind === 'checked' || el.tagName === 'SELECT') ? 'change' : 'input';

    el.addEventListener(event, debounce(async () => {
      let value;
      if (kind === 'checked') value = el.checked;
      else if (kind === 'number') value = Number(el.value);
      else value = el.value.trim();

      if (kind === 'number' && Number.isNaN(value)) return;

      await setSettings({ [settingKey(elId)]: value });
      flashSaved();

      if (elId === 'showCosts') {
        applyCostVisibility(value);
        if (value) renderCosts();
      }
      if (elId === 'modelInput') renderChips(value);
      if (elId === 'noteType') loadFields(value);
      if (elId === 'apiKey') setStatus($('keyStatus'), '');
    }, kind === 'checked' || el.tagName === 'SELECT' ? 0 : 400));
  }
}

function debounce(fn, ms) {
  if (!ms) return fn;
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* ---------- models ---------- */

function renderChips(current) {
  const box = $('curatedChips');
  box.replaceChildren();
  for (const m of CURATED) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `chip${m.id === current ? ' on' : ''}`;
    btn.textContent = m.label;
    btn.title = m.id;
    btn.addEventListener('click', async () => {
      $('modelInput').value = m.id;
      await setSettings({ model: m.id });
      renderChips(m.id);
      describeModel(m.id);
      flashSaved();
    });
    box.append(btn);
  }
}

async function loadModels() {
  try {
    models = await send('models:list', {});
  } catch {
    $('modelHint').textContent = 'Could not reach OpenRouter to load the model list. You can still type a model id.';
    return;
  }
  const list = $('modelList');
  list.replaceChildren();
  for (const m of models) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.label = m.name;
    list.append(opt);
  }
  describeModel($('modelInput').value);
  $('modelInput').addEventListener('input', () => describeModel($('modelInput').value));
}

const per = (v) => `$${(v * 1e6).toFixed(2)}/M`;

function describeModel(id) {
  const m = models.find((x) => x.id === id);
  const hint = $('modelHint');
  if (!m) {
    hint.textContent = 'Type to search all models on OpenRouter.';
    return;
  }
  // A 2,000-word article is ~2,700 input tokens; ~900 output tokens for 8 cards.
  const estimate = 2700 * m.promptPrice + 900 * m.completionPrice;
  hint.textContent = `${m.name} · ${per(m.promptPrice)} in, ${per(m.completionPrice)} out · ${Math.round(m.context / 1000)}k context · roughly $${estimate.toFixed(4)} for a typical article`;
}

/* ---------- key ---------- */

$('revealKey').addEventListener('click', () => {
  const el = $('apiKey');
  const showing = el.type === 'text';
  el.type = showing ? 'password' : 'text';
  $('revealKey').textContent = showing ? 'Show' : 'Hide';
});

$('testKey').addEventListener('click', async () => {
  const el = $('keyStatus');
  const key = $('apiKey').value.trim();
  if (!key) return setStatus(el, 'Paste a key first.', 'bad');

  setStatus(el, 'Checking…');
  try {
    const st = await send('key:status', { apiKey: key });
    const bits = [`Key “${st.label}” works`];
    if (st.limitRemaining !== null) bits.push(`$${Number(st.limitRemaining).toFixed(2)} of credit left`);
    else if (st.usage !== null) bits.push(`$${Number(st.usage).toFixed(2)} used so far`);
    setStatus(el, `${bits.join(' · ')}.`, 'ok');
  } catch (e) {
    setStatus(el, e.message, 'bad');
  }
});

/* ---------- anki ---------- */

async function applyAnkiStatus(st) {
  fillDatalist('deckList', st.decks);
  fillDatalist('noteTypeList', st.models);
  setStatus($('ankiStatus'), `Connected to Anki (AnkiConnect v${st.version}) · ${st.decks.length} decks.`, 'ok');
  loadFields($('noteType').value);
}

function fillDatalist(id, values) {
  const list = $(id);
  list.replaceChildren();
  for (const v of values) {
    const opt = document.createElement('option');
    opt.value = v;
    list.append(opt);
  }
}

async function loadFields(noteType) {
  if (!noteType) return;
  try {
    fillDatalist('fieldList', await send('anki:fields', { noteType }));
  } catch { /* note type may not exist yet — leave the datalist alone */ }
}

async function probeAnki({ quiet } = {}) {
  try {
    applyAnkiStatus(await send('anki:status'));
  } catch (e) {
    if (!quiet) setStatus($('ankiStatus'), e.message, 'bad');
    else setStatus($('ankiStatus'), 'Anki not detected — open Anki, then press Connect.');
  }
}

$('ankiConnect').addEventListener('click', async () => {
  setStatus($('ankiStatus'), 'Waiting for you to click Yes inside Anki…');
  try {
    applyAnkiStatus(await send('anki:connect'));
  } catch (e) {
    setStatus($('ankiStatus'), e.message, 'bad');
  }
});

/* ---------- prompt ---------- */

$('loadDefaultPrompt').addEventListener('click', async () => {
  const el = $('systemPromptOverride');
  if (el.value.trim() && !confirm('Replace the custom prompt with the built-in one?')) return;
  el.value = BUILTIN_SYSTEM_PROMPT;
  await setSettings({ systemPromptOverride: BUILTIN_SYSTEM_PROMPT });
  flashSaved();
});

/* ---------- spending ---------- */

function applyCostVisibility(on) {
  $('costCard').classList.toggle('hidden', !on);
}

const money = (v) => (v >= 0.01 || v === 0 ? `$${v.toFixed(2)}` : `$${v.toFixed(4)}`);
const nf = new Intl.NumberFormat();

function totalTile(key, bucket, note) {
  const el = document.createElement('div');
  el.className = 'total';
  const k = document.createElement('div'); k.className = 'k'; k.textContent = key;
  const v = document.createElement('div'); v.className = 'v'; v.textContent = money(bucket.cost);
  const n = document.createElement('div'); n.className = 'n'; n.textContent = note;
  el.append(k, v, n);
  return el;
}

function table(el, head, rows, emptyText) {
  el.replaceChildren();
  if (!rows.length) {
    // Keep the <table> in the DOM so later renders can still find it.
    const tbody = document.createElement('tbody');
    const td = document.createElement('td');
    td.className = 'table-empty';
    td.colSpan = head.length;
    td.textContent = emptyText;
    const tr = document.createElement('tr');
    tr.append(td);
    tbody.append(tr);
    el.append(tbody);
    return;
  }
  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  head.forEach((hcell) => {
    const th = document.createElement('th');
    th.textContent = hcell.label;
    if (hcell.num) th.className = 'num';
    tr.append(th);
  });
  thead.append(tr);

  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const trb = document.createElement('tr');
    head.forEach((hcell) => {
      const td = document.createElement('td');
      td.className = [hcell.num ? 'num' : '', hcell.truncate ? 'truncate' : ''].filter(Boolean).join(' ');
      if (hcell.truncate) {
        // An inner block is what actually makes the ellipsis work inside a table cell.
        const clip = document.createElement('span');
        clip.className = 'clip';
        clip.textContent = row[hcell.key];
        td.title = row[hcell.key];
        td.append(clip);
      } else {
        td.textContent = row[hcell.key];
      }
      trb.append(td);
    });
    tbody.append(trb);
  }
  el.append(thead, tbody);
}

async function renderCosts() {
  const [summary, entries] = await Promise.all([ledgerSummary(), ledgerAll()]);

  const totals = $('costTotals');
  totals.replaceChildren(
    totalTile('Today', summary.today, `${summary.today.runs} runs · ${summary.today.cards} cards`),
    totalTile('Last 30 days', summary.last30, `${summary.last30.runs} runs · ${summary.last30.cards} cards`),
    totalTile('All time', summary.all, `${summary.all.runs} runs · ${summary.all.cards} cards`),
  );

  const byModel = Object.entries(summary.byModel)
    .sort((a, b) => b[1].cost - a[1].cost)
    .map(([model, b]) => ({
      model,
      runs: nf.format(b.runs),
      cards: nf.format(b.cards),
      tokens: `${nf.format(b.promptTokens)} / ${nf.format(b.completionTokens)}`,
      cost: money(b.cost),
      avg: money(b.cost / Math.max(1, b.runs)),
    }));

  table($('costByModel'), [
    { key: 'model', label: 'Model', truncate: true },
    { key: 'runs', label: 'Runs', num: true },
    { key: 'cards', label: 'Cards', num: true },
    { key: 'tokens', label: 'Tokens in / out', num: true },
    { key: 'avg', label: 'Avg / run', num: true },
    { key: 'cost', label: 'Total', num: true },
  ], byModel, 'No runs recorded yet.');

  const recent = entries.slice(-25).reverse().map((e) => ({
    when: new Date(e.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    title: e.title || e.url,
    model: e.model,
    cards: nf.format(e.cards),
    cost: `${money(e.cost || 0)}${e.costIsEstimate ? '*' : ''}`,
  }));

  table($('costRuns'), [
    { key: 'when', label: 'When' },
    { key: 'title', label: 'Article', truncate: true },
    { key: 'model', label: 'Model', truncate: true },
    { key: 'cards', label: 'Cards', num: true },
    { key: 'cost', label: 'Cost', num: true },
  ], recent, 'No runs recorded yet.');

  const anyEstimate = entries.some((e) => e.costIsEstimate);
  setStatus($('costNote'), anyEstimate
    ? '* estimated from list pricing — the provider did not report a charged amount.'
    : `${entries.length} runs recorded locally.`);
}

$('exportCosts').addEventListener('click', async () => {
  const entries = await ledgerAll();
  const blob = new Blob([ledgerToCsv(entries)], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: 'distiller-costs.csv' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});

$('clearCosts').addEventListener('click', async () => {
  if (!confirm('Delete the whole local cost history? This cannot be undone.')) return;
  await ledgerClear();
  renderCosts();
});

load();
