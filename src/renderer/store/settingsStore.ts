import { create } from 'zustand'
import { AppSettings, AIProvider } from '@shared/types'

interface SettingsStore {
  settings: AppSettings
  isOpen: boolean
  keyStatus: Record<AIProvider, boolean>
  testResult: { success: boolean; message: string; model?: string } | null

  openSettings: () => void
  closeSettings: () => void
  loadSettings: () => Promise<void>
  updateSettings: (partial: Partial<AppSettings>) => Promise<void>
  testConnection: () => Promise<void>
  loadKeyStatus: () => Promise<void>
}

const defaultSettings: AppSettings = {
  aiProvider: 'openai',
  apiKey: '',
  baseURL: '',
  model: '',
  approvalMode: 'sensitive',
  maxAgentSteps: 50,
  agentTimeout: 120000,
  theme: 'dark',
  showChatPanel: false,
  showSupervisor: false,
  mcpServerEnabled: false,
  mcpServerPort: 3900,
  searchEngine: 'google',
  customSearchUrl: '',
  restoreSession: false,
  defaultZoom: 1,
  downloadPath: '',
  askDownloadLocation: false,
  doNotTrack: false,
  savePasswords: true,
  autoSignin: true
}

/** Push the theme onto the document so tailwind's CSS variables swap. */
export function applyTheme(theme: AppSettings['theme']): void {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: defaultSettings,
  isOpen: false,
  keyStatus: {
    openai: false,
    anthropic: false,
    gemini: false,
    ollama: true,
    custom: false,
    zai: false,
    'claude-oauth': false,
    'chatgpt-oauth': false,
    'gemini-oauth': false,
    'gemini-web': false
  },
  testResult: null,

  openSettings: () => set({ isOpen: true }),
  closeSettings: () => set({ isOpen: false }),

  loadSettings: async () => {
    if (!window.api?.settings) return
    try {
      const settings = await window.api.settings.get()
      set({ settings: { ...defaultSettings, ...settings } })
      applyTheme(settings.theme || 'dark')
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  },

  updateSettings: async (partial: Partial<AppSettings>) => {
    if (!window.api?.settings) return
    try {
      const updated = await window.api.settings.set(partial)
      set((state) => ({ settings: { ...state.settings, ...updated } }))
      if (partial.theme) applyTheme(partial.theme)
      await get().loadKeyStatus()
    } catch (error) {
      console.error('Failed to update settings:', error)
    }
  },

  testConnection: async () => {
    if (!window.api?.settings) return
    set({ testResult: null })
    try {
      const result = await window.api.settings.testKey()
      set({ testResult: result })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      set({ testResult: { success: false, message: msg } })
    }
  },

  loadKeyStatus: async () => {
    if (!window.api?.settings) return
    try {
      const status = await window.api.settings.getKeyStatus()
      set({ keyStatus: status })
    } catch (error) {
      console.error('Failed to load key status:', error)
    }
  }
}))
