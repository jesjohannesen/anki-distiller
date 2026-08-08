/* OpenRouter client.

   All network calls live in the background service worker, never in the page, so a
   site's Content-Security-Policy can't block them and the API key never enters a
   page context. */

const OR_BASE = 'https://openrouter.ai/api/v1';
const OR_HEADERS_EXTRA = {
  // OpenRouter uses these for attribution on your activity page. Harmless, not tracking.
  'HTTP-Referer': 'https://github.com/jesjohannesen/anki-distiller',
  'X-Title': 'Distiller',
};

class OpenRouterError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'OpenRouterError';
    this.status = status;
    this.body = body;
  }
}

function authHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    ...OR_HEADERS_EXTRA,
  };
}

/* Friendlier text for the failures people actually hit. */
function explainStatus(status, body) {
  const detail = body?.error?.message || body?.message || '';
  if (status === 401) return 'OpenRouter rejected the API key. Check it in Distiller settings.';
  if (status === 402) return `Not enough OpenRouter credit. ${detail}`.trim();
  if (status === 403) return `OpenRouter refused the request. ${detail}`.trim();
  if (status === 404) return 'That model id does not exist on OpenRouter. Pick another model.';
  if (status === 408 || status === 504) return 'The model took too long to answer. Try a smaller article or a faster model.';
  if (status === 429) return 'Rate limited by OpenRouter. Wait a moment and try again.';
  if (status >= 500) return `OpenRouter or the upstream provider had an error. ${detail}`.trim();
  return detail || `OpenRouter returned HTTP ${status}.`;
}

async function orFetch(path, { apiKey, method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(`${OR_BASE}${path}`, {
      method,
      headers: authHeaders(apiKey),
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new OpenRouterError('Could not reach openrouter.ai. Check your internet connection.', 0, null);
  }

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }

  if (!res.ok) throw new OpenRouterError(explainStatus(res.status, json), res.status, json);
  if (!json) throw new OpenRouterError('OpenRouter returned an unreadable response.', res.status, text);
  return json;
}

/* ---------- model catalogue ---------- */

const MODELS_TTL_MS = 24 * 60 * 60 * 1000;

/* The catalogue is public, so this works before a key is entered. */
async function orModels({ force = false } = {}) {
  const s = await getSettings();
  const fresh = s.modelsCache && (Date.now() - s.modelsCachedAt) < MODELS_TTL_MS;
  if (fresh && !force) return s.modelsCache;

  try {
    const res = await fetch(`${OR_BASE}/models`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { data } = await res.json();
    const slim = data
      // `:batch` variants are queued for hours — useless for an interactive button.
      .filter((m) => !m.id.endsWith(':batch'))
      .map((m) => ({
        id: m.id,
        name: m.name,
        context: m.context_length,
        promptPrice: Number(m.pricing?.prompt || 0),
        completionPrice: Number(m.pricing?.completion || 0),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    await setSettings({ modelsCache: slim, modelsCachedAt: Date.now() });
    return slim;
  } catch (e) {
    // A stale catalogue beats no catalogue.
    if (s.modelsCache) return s.modelsCache;
    throw new OpenRouterError('Could not load the OpenRouter model list.', 0, String(e));
  }
}

async function modelPricing(modelId) {
  const models = await orModels().catch(() => []);
  return models.find((m) => m.id === modelId) || null;
}

/* ---------- key status ---------- */

async function orKeyStatus(apiKey) {
  const json = await orFetch('/key', { apiKey });
  const d = json.data || {};
  return {
    label: d.label || '(unnamed key)',
    usage: d.usage ?? null,
    limit: d.limit ?? null,
    limitRemaining: d.limit_remaining ?? null,
    isFreeTier: !!d.is_free_tier,
  };
}

/* ---------- chat ---------- */

/* Returns { content, usage: { promptTokens, completionTokens, cost, costIsEstimate }, model }.
   `usage: { include: true }` asks OpenRouter for the authoritative charged amount; if a
   provider omits it we fall back to catalogue pricing and flag the number as an estimate. */
async function orChat({ apiKey, model, system, user, temperature, maxTokens, signal }) {
  const json = await orFetch('/chat/completions', {
    apiKey,
    method: 'POST',
    signal,
    body: {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature,
      max_tokens: maxTokens,
      usage: { include: true },
    },
  });

  const choice = json.choices?.[0];
  const content = choice?.message?.content;
  if (!content) {
    const reason = choice?.finish_reason ? ` (finish_reason: ${choice.finish_reason})` : '';
    throw new OpenRouterError(`The model returned an empty response${reason}.`, 200, json);
  }

  const u = json.usage || {};
  const promptTokens = u.prompt_tokens ?? 0;
  const completionTokens = u.completion_tokens ?? 0;

  let cost = typeof u.cost === 'number' ? u.cost : null;
  let costIsEstimate = false;
  if (cost === null) {
    const p = await modelPricing(json.model || model);
    if (p) {
      cost = promptTokens * p.promptPrice + completionTokens * p.completionPrice;
      costIsEstimate = true;
    } else {
      cost = 0;
      costIsEstimate = true;
    }
  }

  return {
    content,
    model: json.model || model,
    usage: { promptTokens, completionTokens, cost, costIsEstimate },
  };
}

globalThis.OpenRouterError = OpenRouterError;
globalThis.orModels = orModels;
globalThis.orKeyStatus = orKeyStatus;
globalThis.orChat = orChat;
globalThis.modelPricing = modelPricing;
