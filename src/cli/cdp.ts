#!/usr/bin/env node
/**
 * Minimal Chrome DevTools Protocol client for the CLI.
 * Zero runtime dependencies: uses Node's built-in fetch + WebSocket (Node >= 22).
 *
 * Session model: a headless Chrome instance is spawned detached and kept alive
 * across CLI invocations. Connection info (port, pid, active tab) lives in
 * ~/.agentic-browser/session.json so `agentic open` followed by `agentic info`
 * talks to the same browser.
 */
import { spawn } from 'child_process'
import fs from 'fs'
import net from 'net'
import os from 'os'
import path from 'path'

export interface TargetInfo {
  idx: number
  id: string
  title: string
  url: string
  ws: string
}

export interface SessionFile {
  port: number
  pid: number
  headless: boolean
  chromePath: string
  activeTab: number
}

interface WsMessage {
  id?: number
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { message: string }
}

export class CDPSession {
  private ws: WebSocket
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private listeners = new Map<string, Array<(params: Record<string, unknown>) => void>>()

  constructor(url: string) {
    this.ws = new WebSocket(url)
  }

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Timed out connecting to page target')), 15000)
      this.ws.addEventListener('open', () => { clearTimeout(t); resolve() }, { once: true })
      this.ws.addEventListener('error', () => { clearTimeout(t); reject(new Error('Failed to connect to page target')) }, { once: true })
    })
    this.ws.addEventListener('message', (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data)) as WsMessage
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!
        this.pending.delete(msg.id)
        if (msg.error) p.reject(new Error(`CDP error (${msg.error.message})`))
        else p.resolve(msg.result)
      } else if (msg.method) {
        for (const cb of this.listeners.get(msg.method) || []) cb(msg.params || {})
      }
    })
    await this.send('Runtime.enable').catch(() => { /* some targets reject; harmless */ })
  }

  send(method: string, params?: Record<string, unknown>, timeoutMs = 30000): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) }
      })
      this.ws.send(JSON.stringify({ id, method, params: params || {} }))
    })
  }

  on(event: string, cb: (params: Record<string, unknown>) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, [])
    this.listeners.get(event)!.push(cb)
  }

  async evaluate<T = unknown>(expression: string): Promise<T> {
    const result = (await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    })) as { result?: { value?: T }; exceptionDetails?: { exception?: { description?: string }; text: string } }
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Page script failed')
    }
    return result.result?.value as T
  }

  close(): void {
    try { this.ws.close() } catch { /* already closed */ }
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

export function sessionDir(): string {
  return path.join(os.homedir(), '.agentic-browser')
}

function sessionFile(): string {
  return path.join(sessionDir(), 'session.json')
}

export function readSession(): SessionFile | null {
  try {
    return JSON.parse(fs.readFileSync(sessionFile(), 'utf8')) as SessionFile
  } catch {
    return null
  }
}

function writeSession(s: SessionFile): void {
  fs.mkdirSync(sessionDir(), { recursive: true })
  fs.writeFileSync(sessionFile(), JSON.stringify(s, null, 2))
}

export function clearSession(): void {
  try { fs.unlinkSync(sessionFile()) } catch { /* no session */ }
}

export function resolveChromeExecutable(explicit?: string): string {
  if (explicit) {
    if (fs.existsSync(explicit)) return explicit
    throw new Error(`--chrome path not found: ${explicit}`)
  }
  if (process.env.AGENTIC_BROWSER_PATH && fs.existsSync(process.env.AGENTIC_BROWSER_PATH)) {
    return process.env.AGENTIC_BROWSER_PATH
  }
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Chromium', 'Application', 'chrome.exe'),
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium'
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  throw new Error(
    'No Chrome/Edge found. Install Chrome or set AGENTIC_BROWSER_PATH / --chrome to the browser executable.'
  )
}

interface ChromeHandle {
  session: CDPSession
  sessionInfo: SessionFile
  targets: TargetInfo[]
}

async function waitForEndpoint(port: number, timeoutMs = 20000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (res.ok) return
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`Chrome started but DevTools endpoint on port ${port} never became ready`)
}

async function listPageTargets(port: number): Promise<TargetInfo[]> {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`)
  const list = (await res.json()) as Array<{ type: string; id: string; title: string; url: string; webSocketDebuggerUrl: string }>
  return list
    .filter((t) => t.type === 'page')
    .map((t, i) => ({ idx: i, id: t.id, title: t.title, url: t.url, ws: t.webSocketDebuggerUrl }))
}

/**
 * Connect to the persistent session browser, launching it if needed.
 * The spawned Chrome is detached, so it survives after the CLI process exits.
 */
export async function connectBrowser(opts: {
  fresh?: boolean
  headful?: boolean
  chrome?: string
} = {}): Promise<ChromeHandle> {
  let info = opts.fresh ? null : readSession()

  if (info) {
    let alive = false
    try {
      const res = await fetch(`http://127.0.0.1:${info.port}/json/version`)
      alive = res.ok
    } catch { alive = false }
    if (!alive) {
      clearSession()
      info = null
    }
  }

  if (!info) {
    const port = await freePort()
    const chromePath = resolveChromeExecutable(opts.chrome)
    const headless = !opts.headful
    const args = [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${path.join(sessionDir(), 'profile')}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--window-size=1440,900'
    ]
    if (headless) args.push('--headless=new')
    const child = spawn(chromePath, args, { detached: true, stdio: 'ignore' })
    child.unref()
    await waitForEndpoint(port)
    const created: SessionFile = { port, pid: child.pid ?? -1, headless, chromePath, activeTab: 0 }
    writeSession(created)
    info = created
  }

  const sess: SessionFile = info
  const targets = await listPageTargets(sess.port)
  if (targets.length === 0) throw new Error('No page targets available in the browser session')

  let idx = Math.min(sess.activeTab, targets.length - 1)
  if (idx < 0) idx = 0

  const session = new CDPSession(targets[idx].ws)
  await session.connect()
  return { session, sessionInfo: sess, targets }
}

/** Switch the active tab for this and future CLI commands. */
export async function switchActiveTab(newIdx: number): Promise<void> {
  const s = readSession()
  if (!s) throw new Error('No browser session. Run `agentic open <url>` first.')
  s.activeTab = newIdx
  writeSession(s)
}

export async function createTab(port: number, url: string): Promise<TargetInfo> {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?url=${encodeURIComponent(url)}`, { method: 'PUT' })
  if (!res.ok) throw new Error(`Failed to create tab (${res.status})`)
  const t = (await res.json()) as { id: string; title: string; url: string; webSocketDebuggerUrl: string }
  return { idx: -1, id: t.id, title: t.title, url: t.url, ws: t.webSocketDebuggerUrl }
}

export async function closeTab(port: number, targetId: string): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`)
  if (!res.ok) throw new Error(`Failed to close tab (${res.status})`)
}

export function killBrowser(pid: number): void {
  clearSession()
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      process.kill(pid, 'SIGTERM')
    }
  } catch { /* already gone */ }
}

/** Wait for page load after a navigation, with a hard timeout fallback. */
export async function waitLoad(session: CDPSession, timeoutMs = 30000): Promise<void> {
  await session.send('Page.enable', undefined, 5000).catch(() => { /* ignore */ })
  await new Promise<void>((resolve) => {
    let done = false
    const finish = () => { if (!done) { done = true; resolve() } }
    session.on('Page.loadEventFired', finish)
    setTimeout(finish, timeoutMs)
  })
  // Small settle so SPA routing / late DOM updates have a chance to land
  await new Promise((r) => setTimeout(r, 400))
}
