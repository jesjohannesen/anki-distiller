/* Cost ledger.

   Every OpenRouter call appends one entry here, whether or not cost tracking is
   visible in the UI. Recording is unconditional so that switching the display on
   later shows real history instead of an empty table; the *display* is what the
   `showCosts` setting gates. Nothing leaves the device — this is a local array in
   extension storage, and "Clear history" really deletes it. */

const LEDGER_KEY = 'costLedger';

async function ledgerAll() {
  const { [LEDGER_KEY]: entries } = await api.storage.local.get(LEDGER_KEY);
  return Array.isArray(entries) ? entries : [];
}

async function ledgerAppend(entry) {
  const { ledgerLimit } = await getSettings();
  const entries = await ledgerAll();
  entries.push(entry);
  const trimmed = entries.slice(-Math.max(1, ledgerLimit));
  await api.storage.local.set({ [LEDGER_KEY]: trimmed });
  return entry;
}

async function ledgerClear() {
  await api.storage.local.remove(LEDGER_KEY);
}

/* Totals for today, the last 30 days, and all time. */
async function ledgerSummary() {
  const entries = await ledgerAll();
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const start30 = now.getTime() - 30 * 24 * 60 * 60 * 1000;

  const bucket = () => ({ cost: 0, runs: 0, cards: 0, promptTokens: 0, completionTokens: 0 });
  const add = (b, e) => {
    b.cost += e.cost || 0;
    b.runs += 1;
    b.cards += e.cards || 0;
    b.promptTokens += e.promptTokens || 0;
    b.completionTokens += e.completionTokens || 0;
  };

  const today = bucket(), last30 = bucket(), all = bucket();
  for (const e of entries) {
    add(all, e);
    if (e.ts >= start30) add(last30, e);
    if (e.ts >= startOfToday) add(today, e);
  }

  const byModel = {};
  for (const e of entries) {
    byModel[e.model] = byModel[e.model] || bucket();
    add(byModel[e.model], e);
  }

  return { today, last30, all, byModel, count: entries.length };
}

function ledgerToCsv(entries) {
  const head = ['timestamp', 'model', 'prompt_tokens', 'completion_tokens', 'cost_usd', 'cards', 'title', 'url'];
  const esc = (v) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = entries.map((e) => [
    new Date(e.ts).toISOString(), e.model, e.promptTokens, e.completionTokens,
    (e.cost ?? 0).toFixed(6), e.cards, e.title, e.url,
  ].map(esc).join(','));
  return [head.join(','), ...rows].join('\n');
}

globalThis.ledgerAll = ledgerAll;
globalThis.ledgerAppend = ledgerAppend;
globalThis.ledgerClear = ledgerClear;
globalThis.ledgerSummary = ledgerSummary;
globalThis.ledgerToCsv = ledgerToCsv;
