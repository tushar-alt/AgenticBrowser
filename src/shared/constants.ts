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
  custom: []
}

export const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  ollama: 'http://localhost:11434'
}
