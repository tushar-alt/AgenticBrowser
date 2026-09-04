import { safeStorage, Notification } from 'electron'
import Store from 'electron-store'
import crypto from 'crypto'
import { SavedPasswordMeta } from '@shared/types'

interface StoredPassword extends SavedPasswordMeta {
  passwordEnc: string
}

/**
 * Lightweight password manager: credentials captured from login forms are
 * encrypted with the OS-level safeStorage (DPAPI on Windows) and stored in the
 * user profile. The CLI-adjacent philosophy applies here too: nothing leaves
 * the machine.
 */
export class PasswordVault {
  private store: Store<{ passwords: StoredPassword[] }>

  constructor() {
    this.store = new Store<{ passwords: StoredPassword[] }>({
      name: 'passwords',
      defaults: { passwords: [] }
    })
  }

  private all(): StoredPassword[] {
    return this.store.get('passwords', [])
  }

  static originOf(url: string): string {
    try {
      return new URL(url).origin
    } catch {
      return ''
    }
  }

  list(): SavedPasswordMeta[] {
    return this.all().map(({ passwordEnc: _enc, ...meta }) => meta)
  }

  /** Returns 'saved' | 'updated' | 'unchanged' | 'disabled' (no OS encryption). */
  save(url: string, username: string, password: string): 'saved' | 'updated' | 'unchanged' | 'disabled' {
    if (!password) return 'unchanged'
    if (!safeStorage.isEncryptionAvailable()) return 'disabled'
    const origin = PasswordVault.originOf(url)
    if (!origin || !origin.startsWith('http')) return 'unchanged'

    const passwords = this.all()
    const existing = passwords.find((p) => p.origin === origin && p.username === username)
    if (existing) {
      const current = safeStorage.decryptString(Buffer.from(existing.passwordEnc, 'base64'))
      if (current === password) return 'unchanged'
      existing.passwordEnc = safeStorage.encryptString(password).toString('base64')
      existing.updatedAt = Date.now()
      this.store.set('passwords', passwords)
      return 'updated'
    }
    passwords.push({
      id: crypto.randomUUID(),
      origin,
      username,
      passwordEnc: safeStorage.encryptString(password).toString('base64'),
      updatedAt: Date.now()
    })
    this.store.set('passwords', passwords)
    return 'saved'
  }

  delete(id: string): boolean {
    const passwords = this.all()
    const filtered = passwords.filter((p) => p.id !== id)
    if (filtered.length === passwords.length) return false
    this.store.set('passwords', filtered)
    return true
  }

  clear(): void {
    this.store.set('passwords', [])
  }

  reveal(id: string): string | null {
    const entry = this.all().find((p) => p.id === id)
    if (!entry) return null
    try {
      return safeStorage.decryptString(Buffer.from(entry.passwordEnc, 'base64'))
    } catch {
      return null
    }
  }

  findForOrigin(url: string): { username: string; password: string } | null {
    const origin = PasswordVault.originOf(url)
    if (!origin) return null
    const entry = this.all()
      .filter((p) => p.origin === origin)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (!entry) return null
    try {
      return {
        username: entry.username,
        password: safeStorage.decryptString(Buffer.from(entry.passwordEnc, 'base64'))
      }
    } catch {
      return null
    }
  }

  static notifySaved(origin: string, kind: 'saved' | 'updated'): void {
    try {
      new Notification({
        title: kind === 'updated' ? 'Password updated' : 'Password saved',
        body: `Credentials for ${origin} stored encrypted on this device.`,
        silent: true
      }).show()
    } catch { /* notifications unavailable */ }
  }
}
