/* Settings: defaults, read, write.
   Everything lives in extension-local storage. Nothing is synced to a server. */

const CURATED_MODELS = [
  { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5', note: 'Balanced default' },
  { id: 'anthropic/claude-opus-5', label: 'Claude Opus 5', note: 'Highest quality' },
  { id: 'openai/gpt-5.6-terra', label: 'GPT-5.6 Terra', note: 'Strong all-rounder' },
  { id: 'openai/gpt-5.6-luna', label: 'GPT-5.6 Luna', note: 'Cheap and quick' },
  { id: 'google/gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite', note: 'Cheap, long context' },
  { id: 'x-ai/grok-4.5', label: 'Grok 4.5', note: 'Alternative voice' },
  { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash', note: 'Lowest cost' },
];

const DEFAULT_SYSTEM_PROMPT = ''; // empty = use the built-in prompt in lib/prompt.js

const DEFAULTS = {
  // OpenRouter
  apiKey: '',
  model: 'anthropic/claude-sonnet-5',
  temperature: 0.3,
  maxOutputTokens: 4000,
  maxArticleChars: 48000,

  // Card generation
  targetCards: 8,             // 0 = let the model decide
  language: 'auto',           // 'auto' = same language as the article
  appendSource: true,         // put the source link on the back of each card
  extraTags: '',              // comma separated, added to every card
  systemPromptOverride: DEFAULT_SYSTEM_PROMPT,

  // Anki
  ankiUrl: 'http://127.0.0.1:8765',
  deck: 'Default',
  noteType: 'Basic',
  frontField: 'Front',
  backField: 'Back',
  allowDuplicates: false,

  // Cost tracking — hidden until switched on
  showCosts: false,
  ledgerLimit: 500,           // entries kept before the oldest are dropped

  // Model catalogue cache
  modelsCache: null,
  modelsCachedAt: 0,
};

async function getSettings() {
  const stored = await api.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

async function setSettings(patch) {
  await api.storage.local.set(patch);
  return getSettings();
}

globalThis.DEFAULTS = DEFAULTS;
globalThis.CURATED_MODELS = CURATED_MODELS;
globalThis.getSettings = getSettings;
globalThis.setSettings = setSettings;
