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
  ollama: ['qwen2.5:1.5b', 'tinyllama:1.1b', 'llama3.2:1b', 'llama3.1', 'mistral'],
  custom: [],
  zai: ['glm-4.6', 'glm-5', 'glm-5-turbo', 'glm-5.3'],
  'claude-oauth': ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-3-5-haiku-20241022'],
  'gemini-web': ['gemini-web-flash', 'gemini-web-thinking', 'gemini-web-pro', 'gemini-web-auto'],
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
  'gemini-web': 'Gemini Web (no key needed)',
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

/** Official download sources for popular software — used by the deterministic
 * download flow so "download X" completes with ANY model. hrefTokens must all
 * appear (lowercase) in the download link for it to be trusted. */
export interface SoftwareSite {
  key: string
  name: string
  aliases: string[]
  page: string
  hrefTokens: string[]
  fallbackName: string
}

export const SOFTWARE_SITES: SoftwareSite[] = [
  {
    key: 'android studio', name: 'Android Studio', aliases: ['android studio'],
    page: 'https://developer.android.com/studio',
    hrefTokens: ['android/studio', '.exe'], fallbackName: 'android-studio-installer.exe'
  },
  {
    key: 'visual studio code', name: 'Visual Studio Code', aliases: ['visual studio code', 'vscode', 'vs code'],
    page: 'https://code.visualstudio.com/download',
    hrefTokens: ['vscode.download.prss.microsoft.com', '.exe'], fallbackName: 'vscode-installer.exe'
  },
  {
    key: 'node.js', name: 'Node.js', aliases: ['nodejs', 'node.js', 'node '],
    page: 'https://nodejs.org/en/download',
    hrefTokens: ['nodejs.org/dist', 'x64.msi'], fallbackName: 'node-installer.msi'
  },
  {
    key: 'python', name: 'Python', aliases: ['python'],
    page: 'https://www.python.org/downloads/',
    hrefTokens: ['python.org/ftp', '.exe'], fallbackName: 'python-installer.exe'
  },
  {
    key: 'firefox', name: 'Firefox', aliases: ['firefox'],
    page: 'https://www.mozilla.org/en-US/firefox/new/',
    hrefTokens: ['download.mozilla.org'], fallbackName: 'firefox-installer.exe'
  },
  {
    key: '7-zip', name: '7-Zip', aliases: ['7-zip', '7zip'],
    page: 'https://www.7-zip.org/download.html',
    hrefTokens: ['7-zip.org/a', 'x64.exe'], fallbackName: '7zip-installer.exe'
  },
  {
    key: 'obs studio', name: 'OBS Studio', aliases: ['obs studio', 'obsproject'],
    page: 'https://obsproject.com/download',
    hrefTokens: ['obsproject.com/downloads', '.exe'], fallbackName: 'obs-installer.exe'
  }
]
