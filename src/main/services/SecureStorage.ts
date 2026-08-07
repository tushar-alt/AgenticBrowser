import { safeStorage } from 'electron'
import Store from 'electron-store'
import { AIKeyConfig, AIProvider } from '@shared/types'

interface KeyStoreData {
  configs: Record<string, AIKeyConfig>
  activeProvider: AIProvider
}

export class SecureStorage {
  private store: Store<KeyStoreData>

  constructor() {
    this.store = new Store<KeyStoreData>({
      name: 'ai-keys',
      defaults: {
        configs: {},
        activeProvider: 'openai'
      }
    })
  }

  isEncryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  saveKey(provider: AIProvider, apiKey: string, baseURL?: string, model?: string): void {
    if (!this.isEncryptionAvailable()) {
      throw new Error('OS-level encryption is not available on this system')
    }

    const encrypted = safeStorage.encryptString(apiKey)
    const config: AIKeyConfig = {
      provider,
      encryptedKey: encrypted.toString('base64'),
      baseURL,
      model
    }

    const configs = this.store.get('configs', {})
    configs[provider] = config
    this.store.set('configs', configs)
    this.store.set('activeProvider', provider)
  }

  getKey(provider?: AIProvider): string | null {
    const target = provider || this.store.get('activeProvider', 'openai')
    const configs = this.store.get('configs', {})
    const config = configs[target]

    if (!config) return null

    const buffer = Buffer.from(config.encryptedKey, 'base64')
    return safeStorage.decryptString(buffer)
  }

  getConfig(provider?: AIProvider): AIKeyConfig | null {
    const target = provider || this.store.get('activeProvider', 'openai')
    const configs = this.store.get('configs', {})
    return configs[target] || null
  }

  getActiveProvider(): AIProvider {
    return this.store.get('activeProvider', 'openai')
  }

  setActiveProvider(provider: AIProvider): void {
    this.store.set('activeProvider', provider)
  }

  hasKey(provider: AIProvider): boolean {
    const configs = this.store.get('configs', {})
    return !!configs[provider]
  }

  removeKey(provider: AIProvider): void {
    const configs = this.store.get('configs', {})
    delete configs[provider]
    this.store.set('configs', configs)
  }

  getProviderStatus(): Record<AIProvider, boolean> {
    const configs = this.store.get('configs', {})
    return {
      openai: !!configs.openai,
      anthropic: !!configs.anthropic,
      gemini: !!configs.gemini,
      ollama: true,
      custom: !!configs.custom
    }
  }
}
