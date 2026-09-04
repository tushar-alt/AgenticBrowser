import Store from 'electron-store'
import { AppSettings } from '@shared/types'

/**
 * Durable app settings. Previously settings lived in a plain in-memory object
 * and every preference reset on relaunch; everything now persists here.
 */
const DEFAULT_SETTINGS: AppSettings = {
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

const store = new Store<{ settings: AppSettings }>({
  name: 'settings',
  defaults: { settings: DEFAULT_SETTINGS }
})

export function getSettings(): AppSettings {
  return { ...DEFAULT_SETTINGS, ...store.get('settings') }
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  const merged = { ...getSettings(), ...partial }
  store.set('settings', merged)
  return merged
}
