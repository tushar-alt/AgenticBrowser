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
  mcpServerPort: 3900
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: defaultSettings,
  isOpen: false,
  keyStatus: {
    openai: false,
    anthropic: false,
    gemini: false,
    ollama: true,
    custom: false
  },
  testResult: null,

  openSettings: () => set({ isOpen: true }),
  closeSettings: () => set({ isOpen: false }),

  loadSettings: async () => {
    if (!window.api?.settings) return
    try {
      const settings = await window.api.settings.get()
      set({ settings: { ...defaultSettings, ...settings } })
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  },

  updateSettings: async (partial: Partial<AppSettings>) => {
    if (!window.api?.settings) return
    try {
      const updated = await window.api.settings.set(partial)
      set((state) => ({ settings: { ...state.settings, ...updated } }))
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
      set({ testResult: { success: false, message: String(error) } })
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
