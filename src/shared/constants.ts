/**
 * Layout constants shared between the main process (native view positioning)
 * and the renderer (React chrome). Keep these in sync with the Tailwind
 * heights used in App.tsx: tab strip h-10 (40px) + toolbar h-12 (48px).
 */
export const TAB_STRIP_HEIGHT = 40
export const TOOLBAR_HEIGHT = 48
export const CHROME_HEIGHT = TAB_STRIP_HEIGHT + TOOLBAR_HEIGHT
export const ASSISTANT_PANEL_WIDTH = 400

export const DEFAULT_AI_MODELS: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  anthropic: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
  gemini: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash'],
  ollama: ['llama3.1', 'mistral', 'codellama', 'phi3'],
  custom: [],
  zai: ['glm-4.6', 'glm-5', 'glm-5-turbo', 'glm-5.3'],
  'claude-oauth': ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-3-5-haiku-20241022'],
  'chatgpt-oauth': ['gpt-5', 'gpt-5-codex', 'gpt-4.1', 'o4-mini']
}

export const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  ollama: 'http://localhost:11434',
  zai: 'https://api.z.ai/api/anthropic'
}

export const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (API key)',
  gemini: 'Google Gemini',
  ollama: 'Ollama (local)',
  custom: 'Custom (OpenAI-compatible)',
  zai: 'Z.ai — GLM Coding Plan',
  'claude-oauth': 'Claude Pro / Max (sign in)',
  'chatgpt-oauth': 'ChatGPT Plus / Pro (sign in)'
}

export const SEARCH_ENGINES: Array<{ id: string; name: string; url: string }> = [
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=%s' },
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  { id: 'custom', name: 'Custom…', url: '' }
]

/** Turn a search query into a URL using the configured engine. */
export function buildSearchUrl(engine: string, customUrl: string, query: string): string {
  const template =
    engine === 'custom' && customUrl.includes('%s')
      ? customUrl
      : SEARCH_ENGINES.find((e) => e.id === engine)?.url || SEARCH_ENGINES[0].url
  return template.replace('%s', encodeURIComponent(query))
}
