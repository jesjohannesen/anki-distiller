/* AnkiConnect client.

   AnkiConnect is an Anki desktop add-on (code 2055492159) that listens on
   127.0.0.1:8765. It only answers requests whose Origin is in its allow-list, so the
   first call an extension makes must be `requestPermission`, which pops a dialog
   inside Anki and — once accepted — records this extension's origin permanently. */

class AnkiError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = 'AnkiError';
    this.kind = kind; // 'offline' | 'permission' | 'api'
  }
}

async function ankiInvoke(action, params = {}, { url, timeoutMs = 10000 } = {}) {
  const base = url || (await getSettings()).ankiUrl;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, version: 6, params }),
      signal: controller.signal,
    });
  } catch {
    throw new AnkiError('Anki is not reachable. Open Anki desktop with the AnkiConnect add-on installed.', 'offline');
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 403) {
    throw new AnkiError('AnkiConnect refused this extension. Run "Connect to Anki" in Distiller settings and click Yes in Anki.', 'permission');
  }
  if (!res.ok) throw new AnkiError(`AnkiConnect returned HTTP ${res.status}.`, 'api');

  const json = await res.json();
  if (json.error) throw new AnkiError(json.error, 'api');
  return json.result;
}

/* Prompts inside Anki the first time; returns quietly on later calls. */
async function ankiRequestPermission(url) {
  const result = await ankiInvoke('requestPermission', {}, { url, timeoutMs: 60000 });
  if (result?.permission !== 'granted') {
    throw new AnkiError('Permission was not granted in Anki. Click Yes on the dialog that appears in Anki.', 'permission');
  }
  return result;
}

async function ankiStatus(url) {
  const version = await ankiInvoke('version', {}, { url, timeoutMs: 4000 });
  const [decks, models] = await Promise.all([
    ankiInvoke('deckNames', {}, { url }),
    ankiInvoke('modelNames', {}, { url }),
  ]);
  return { version, decks: decks.sort(), models: models.sort() };
}

async function ankiFieldNames(noteType, url) {
  return ankiInvoke('modelFieldNames', { modelName: noteType }, { url });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* Anki fields are HTML. Preserve paragraph breaks, escape everything else. */
function toAnkiHtml(text) {
  return escapeHtml(text).trim().replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
}

function buildNote(card, { deck, noteType, frontField, backField, allowDuplicates, source, tags }) {
  const fields = {};
  fields[frontField] = toAnkiHtml(card.front);
  let back = toAnkiHtml(card.back);
  if (source?.url) {
    const label = escapeHtml(source.title || source.url);
    back += `<br><br><div style="font-size:0.8em;opacity:0.65">Source: <a href="${escapeHtml(source.url)}">${label}</a></div>`;
  }
  fields[backField] = back;

  return {
    deckName: deck,
    modelName: noteType,
    fields,
    // Per-card topic tags, plus whatever the caller applies to the whole batch.
    tags: [...new Set([...(tags || []), ...(card.tags || [])])],
    options: {
      allowDuplicate: !!allowDuplicates,
      duplicateScope: 'deck',
    },
  };
}

/* addNotes returns one id per note, with null where a note was rejected as a
   duplicate — so a partial success is normal and worth reporting honestly. */
async function ankiAddCards(cards, opts) {
  const { deck, url } = opts;
  const existing = await ankiInvoke('deckNames', {}, { url });
  if (!existing.includes(deck)) await ankiInvoke('createDeck', { deck }, { url });

  const notes = cards.map((c) => buildNote(c, opts));
  const ids = await ankiInvoke('addNotes', { notes }, { url, timeoutMs: 30000 });

  const added = ids.filter(Boolean).length;
  const skipped = ids.length - added;
  return { added, skipped, ids };
}

globalThis.AnkiError = AnkiError;
globalThis.ankiInvoke = ankiInvoke;
globalThis.ankiRequestPermission = ankiRequestPermission;
globalThis.ankiStatus = ankiStatus;
globalThis.ankiFieldNames = ankiFieldNames;
globalThis.ankiAddCards = ankiAddCards;
