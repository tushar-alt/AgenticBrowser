import { safeStorage } from 'electron'
import { createServer, type Server } from 'http'
import crypto from 'crypto'
import Store from 'electron-store'

/**
 * Subscription sign-in (OAuth) for AI providers whose subscriptions can drive
 * the agent — Claude Pro/Max and ChatGPT Plus/Pro — using the same PKCE +
 * loopback flow their CLIs use. Tokens are encrypted with the OS keychain and
 * never leave the machine. Z.ai's Coding Plan has no public OAuth and connects
 * with its plan API key instead (preset in the Settings UI).
 */

export type OAuthKind = 'claude' | 'chatgpt'

interface OAuthTokens {
  accessTokenEnc: string
  refreshTokenEnc: string
  expiresAt: number
}

interface ProviderConfig {
  clientId: string
  authorizeUrl: string
  tokenUrl: string
  scope: string
  /** Fixed callback port required by the provider; undefined = ephemeral. */
  port?: number
  callbackPath: string
  extraAuthorize?: Record<string, string>
}

const PROVIDERS: Record<OAuthKind, ProviderConfig> = {
  claude: {
    // Claude Code's public OAuth client — Claude Pro/Max subscription login.
    clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    authorizeUrl: 'https://claude.ai/oauth/authorize',
    tokenUrl: 'https://console.anthropic.com/v1/oauth/token',
    scope: 'oauth:create_token user:profile',
    callbackPath: '/callback'
  },
  chatgpt: {
    // Codex CLI's public OAuth client — ChatGPT Plus/Pro subscription login.
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    authorizeUrl: 'https://auth.openai.com/oauth/authorize',
    tokenUrl: 'https://auth.openai.com/oauth/token',
    scope: 'openid profile email offline_access',
    port: 1455,
    callbackPath: '/auth/callback',
    extraAuthorize: {
      'codex_cli_simplified_flow': 'true',
      'id_token_add_organizations': 'true'
    }
  }
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface OAuthStatus {
  connected: boolean
  expiresAt?: number
}

export class OAuthAccounts {
  private store: Store<{ tokens: Partial<Record<OAuthKind, OAuthTokens>> }>

  constructor() {
    this.store = new Store<{ tokens: Partial<Record<OAuthKind, OAuthTokens>> }>({
      name: 'oauth-accounts',
      defaults: { tokens: {} }
    })
  }

  private encrypt(secret: string): string {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS-level encryption unavailable')
    return safeStorage.encryptString(secret).toString('base64')
  }

  private decrypt(enc: string): string {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  }

  status(kind: OAuthKind): OAuthStatus {
    const t = this.store.get('tokens', {})[kind]
    return t ? { connected: true, expiresAt: t.expiresAt } : { connected: false }
  }

  statusAll(): Record<OAuthKind, OAuthStatus> {
    return { claude: this.status('claude'), chatgpt: this.status('chatgpt') }
  }

  disconnect(kind: OAuthKind): boolean {
    const tokens = this.store.get('tokens', {})
    if (!tokens[kind]) return false
    delete tokens[kind]
    this.store.set('tokens', tokens)
    return true
  }

  /** Get a usable access token, transparently refreshing when close to expiry. */
  async accessToken(kind: OAuthKind): Promise<string> {
    const t = this.store.get('tokens', {})[kind]
    if (!t) throw new Error(`Not signed in to ${kind}. Sign in from Settings → AI Provider.`)
    const accessToken = this.decrypt(t.accessTokenEnc)
    if (Date.now() < t.expiresAt - 120_000) return accessToken

    const cfg = PROVIDERS[kind]
    const refreshToken = this.decrypt(t.refreshTokenEnc)
    const res = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: cfg.clientId
      })
    })
    if (!res.ok) {
      this.disconnect(kind)
      throw new Error(`${kind} session expired — sign in again from Settings. (${res.status})`)
    }
    const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number }
    const tokens = this.store.get('tokens', {})
    tokens[kind] = {
      accessTokenEnc: this.encrypt(data.access_token),
      refreshTokenEnc: this.encrypt(data.refresh_token || refreshToken),
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000
    }
    this.store.set('tokens', tokens)
    return data.access_token
  }

  /**
   * PKCE authorization-code flow: bind a loopback callback server, open the
   * provider's sign-in page in the user's default browser, exchange the code,
   * store encrypted tokens. Resolves once signed in.
   */
  async signIn(kind: OAuthKind, openExternal: (url: string) => void, timeoutMs = 5 * 60_000): Promise<OAuthStatus> {
    const cfg = PROVIDERS[kind]
    const verifier = b64url(crypto.randomBytes(48))
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
    const state = b64url(crypto.randomBytes(16))

    const done = new Promise<void>((resolve, reject) => {
      let server: Server | null = null
      const finish = (err?: Error) => {
        server?.close()
        clearTimeout(timer)
        err ? reject(err) : resolve()
      }
      const timer = setTimeout(() => finish(new Error('Sign-in timed out — try again')), timeoutMs)

      server = createServer((req, res) => {
        const u = new URL(req.url || '/', 'http://127.0.0.1')
        if (u.pathname !== cfg.callbackPath) {
          res.writeHead(404).end()
          return
        }
        const code = u.searchParams.get('code')
        const error = u.searchParams.get('error')
        const stateOk = u.searchParams.get('state') === state
        const ok = !error && code && stateOk
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(
          `<body style="font-family:system-ui;background:#0e0e10;color:#f2efe6;display:grid;place-items:center;height:100vh;margin:0">` +
          `<div style="text-align:center"><h2>${ok ? '✓ Signed in' : 'Sign-in failed'}</h2>` +
          `<p>${ok ? 'You can close this tab and return to AgenticBrowser.' : error}</p></div></body>`
        )
        if (!ok) {
          finish(new Error(error || 'Authorization was cancelled'))
          return
        }
        this.exchange(kind, code!, verifier, `http://localhost:${(server!.address() as { port: number }).port}${cfg.callbackPath}`)
          .then(() => finish())
          .catch((e) => finish(e as Error))
      })
      server.listen(cfg.port ?? 0, '127.0.0.1', () => {
        const port = (server!.address() as { port: number }).port
        const authorizeUrl = new URL(cfg.authorizeUrl)
        authorizeUrl.searchParams.set('client_id', cfg.clientId)
        authorizeUrl.searchParams.set('response_type', 'code')
        authorizeUrl.searchParams.set('redirect_uri', `http://localhost:${port}${cfg.callbackPath}`)
        authorizeUrl.searchParams.set('scope', cfg.scope)
        authorizeUrl.searchParams.set('state', state)
        authorizeUrl.searchParams.set('code_challenge', challenge)
        authorizeUrl.searchParams.set('code_challenge_method', 'S256')
        for (const [k, v] of Object.entries(cfg.extraAuthorize || {})) {
          authorizeUrl.searchParams.set(k, v)
        }
        openExternal(authorizeUrl.toString())
      })
      server.on('error', (e) => finish(new Error(`Could not bind local callback server: ${e.message}`)))
    })

    await done
    return this.status(kind)
  }

  private async exchange(kind: OAuthKind, code: string, verifier: string, redirectUri: string): Promise<void> {
    const cfg = PROVIDERS[kind]
    const res = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: cfg.clientId,
        redirect_uri: redirectUri,
        code_verifier: verifier
      })
    })
    if (!res.ok) {
      throw new Error(`Token exchange failed (${res.status}): ${(await res.text()).substring(0, 200)}`)
    }
    const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number }
    const tokens = this.store.get('tokens', {})
    tokens[kind] = {
      accessTokenEnc: this.encrypt(data.access_token),
      refreshTokenEnc: this.encrypt(data.refresh_token || ''),
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000
    }
    this.store.set('tokens', tokens)
  }
}
