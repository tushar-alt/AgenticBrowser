import { app, BaseWindow, dialog, Menu, session as electronSession, WebContentsView, type Input, type Session } from 'electron'
import crypto from 'crypto'
import path from 'path'
import { TabInfo, NEW_TAB_URL, DownloadItem } from '@shared/types'
import { CHROME_HEIGHT, buildSearchUrl } from '@shared/constants'
import { getSettings } from './services/AppSettingsStore'
import { PasswordVault } from './services/PasswordVault'

/** Normalize a key event to a combo string like "mod+k" / "mod+shift+a"; null when not an app shortcut. */
function normalizeShortcut(input: Input): string | null {
  const mod = input.control || input.meta
  if (!mod) return null
  const key = input.key.toLowerCase()
  if (!['k', 'b', 'f', 'h', 'l', 't', 'w', 'j', 'r'].includes(key)) return null
  const parts = ['mod']
  if (input.shift) parts.push('shift')
  parts.push(key)
  return parts.join('+')
}

/** Hook injected into pages: remembers submitted login credentials for the NEXT navigation. */
const CAPTURE_HOOK = `
(function () {
  if (window.__ab_pw_hook) return true;
  window.__ab_pw_hook = 1;
  function hook(f) {
    if (f.__ab_hook) return;
    f.__ab_hook = 1;
    f.addEventListener('submit', function () {
      try {
        var pw = f.querySelector('input[type=password]');
        if (!pw || !pw.value) return;
        var user = f.querySelector('input[type=email], input[type=text], input[autocomplete*="username"], input[name*="user"], input[name*="email"], input[name*="login"]');
        sessionStorage.setItem('__ab_save', JSON.stringify({ u: (user && user.value) || '', p: pw.value }));
      } catch (e) {}
    }, true);
  }
  document.querySelectorAll('form').forEach(hook);
  new MutationObserver(function () { document.querySelectorAll('form').forEach(hook); })
    .observe(document.documentElement, { childList: true, subtree: true });
  return true;
})()
`

function readCaptureScript(): string {
  return `
(function () {
  try {
    var v = sessionStorage.getItem('__ab_save');
    if (v) sessionStorage.removeItem('__ab_save');
    return v;
  } catch (e) { return null; }
})()
`
}

function autofillScript(creds: { username: string; password: string }): string {
  const payload = JSON.stringify(creds)
  return `
(function () {
  try {
    var creds = ${payload};
    var pw = document.querySelector('input[type=password]');
    if (!pw || pw.value) return false;
    var user = document.querySelector('input[type=email], input[type=text], input[autocomplete*="username"], input[name*="user"], input[name*="email"], input[name*="login"]');
    if (user && !user.value) {
      user.value = creds.username;
      user.dispatchEvent(new Event('input', { bubbles: true }));
      user.dispatchEvent(new Event('change', { bubbles: true }));
    }
    pw.value = creds.password;
    pw.dispatchEvent(new Event('input', { bubbles: true }));
    pw.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  } catch (e) { return false; }
})()
`
}

interface TabEntry {
  id: string
  view: WebContentsView
  info: TabInfo
}

export class TabManager {
  private tabs: Map<string, TabEntry> = new Map()
  private activeTabId: string | null = null
  private window: BaseWindow
  private rightInset: number = 0
  private overlayActive: boolean = false
  private onTabUpdate: ((tabs: TabInfo[], activeId: string | null) => void) | null = null
  private onShortcut: ((combo: string) => void) | null = null
  private onDownloadUpdate: ((downloads: DownloadItem[]) => void) | null = null
  private downloads: DownloadItem[] = []
  private vault = new PasswordVault()
  private configuredSessions = new WeakSet<Session>()

  constructor(window: BaseWindow) {
    this.window = window
  }

  setTabUpdateCallback(cb: (tabs: TabInfo[], activeId: string | null) => void): void {
    this.onTabUpdate = cb
  }

  setDownloadUpdateCallback(cb: (downloads: DownloadItem[]) => void): void {
    this.onDownloadUpdate = cb
  }

  getDownloads(): DownloadItem[] {
    return [...this.downloads]
  }

  /**
   * Web pages own the keyboard while focused, so renderer-side keydown listeners
   * in the chrome never fire on real sites. Tab views report app shortcuts here
   * (normalized, e.g. "mod+k", "mod+shift+a") before the page sees them.
   */
  setShortcutCallback(cb: (combo: string) => void): void {
    this.onShortcut = cb
  }

  /** Reserve space on the right (e.g. for the Assistant panel) so the native tab view doesn't cover it. */
  setRightInset(px: number): void {
    this.rightInset = Math.max(0, px)
    this.layoutActiveTab()
  }

  /**
   * Modal overlays (command palette, settings, history, bookmarks) are drawn by
   * the React chrome, which sits UNDER the native tab view. While an overlay is
   * open the page's native view must step aside, otherwise the overlay is
   * invisible. Find-in-page is exempt: its highlights live in the page itself.
   */
  setOverlayActive(active: boolean): void {
    this.overlayActive = active
    const activeEntry = this.getActiveTab()
    if (!activeEntry) return
    activeEntry.view.setVisible(active ? false : !activeEntry.info.isNewTab)
    if (!active) this.layoutActiveTab()
  }

  createTab(url?: string, incognito = false): string {
    const id = crypto.randomUUID()
    const isNewTab = !url

    // Incognito tabs use a temporary session that's discarded on close.
    // Regular tabs share a persistent session for cookie/cache sharing.
    const partition = incognito ? `tmp:${id}` : 'persist:app'
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition,
        javascript: true,
        webSecurity: true,
        // Enable shipping-but-not-default web platform features so modern
        // site CSS/JS parses exactly like stable Chrome.
        experimentalFeatures: true,
        backgroundThrottling: true
      },
    })

    const info: TabInfo = {
      id,
      title: 'New Tab',
      url: url || NEW_TAB_URL,
      favicon: '',
      isActive: false,
      isLoading: false,
      isNewTab,
      canGoBack: false,
      canGoForward: false,
      incognito
    }

    const entry: TabEntry = { id, view, info }
    this.tabs.set(id, entry)

    // White page canvas: prevents black/transparent paint flashes while a
    // site loads and avoids compositor glitches on layered views.
    view.setBackgroundColor('#ffffff')

    this.setupTabEvents(entry)
    this.configureSession(view.webContents.session)

    this.window.contentView.addChildView(view)

    if (url) {
      view.webContents.loadURL(url)
    } else {
      // New tab: the renderer draws the dashboard, so keep the native view hidden.
      view.setVisible(false)
      view.webContents.loadURL(NEW_TAB_URL)
    }

    this.switchToTab(id)
    return id
  }

  private setupTabEvents(entry: TabEntry): void {
    const { view, info, id } = entry

    view.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || !this.onShortcut) return
      const combo = normalizeShortcut(input)
      if (!combo) return
      event.preventDefault()
      this.onShortcut(combo)
    })

    // Context menu (right-click)
    view.webContents.on('context-menu', (_event, params) => {
      const template: Electron.MenuItemConstructorOptions[] = []

      if (params.selectionText) {
        template.push({ label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' })
        template.push({ type: 'separator' })
        template.push({
          label: 'Ask AI about selection',
          click: () => {
            this.onShortcut?.('mod+b')
          }
        })
      }

      if (params.mediaType === 'image' && params.srcURL) {
        template.push({
          label: 'Save image as...',
          click: () => {
            dialog.showSaveDialog(this.window, {
              defaultPath: params.srcURL.split('/').pop() || 'image.png'
            }).then(({ filePath }) => {
              if (filePath) {
                view.webContents.downloadURL(params.srcURL)
              }
            })
          }
        })
        template.push({
          label: 'Copy image URL',
          click: () => {
            const { clipboard } = require('electron')
            clipboard.writeText(params.srcURL)
          }
        })
        template.push({ type: 'separator' })
      }

      if (params.linkURL) {
        template.push({
          label: 'Open link in new tab',
          click: () => this.createTab(params.linkURL)
        })
        template.push({
          label: 'Copy link address',
          click: () => {
            const { clipboard } = require('electron')
            clipboard.writeText(params.linkURL)
          }
        })
        template.push({ type: 'separator' })
      }

      if (params.isEditable) {
        template.push({ label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' })
        template.push({ label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', role: 'redo' })
        template.push({ type: 'separator' })
        template.push({ label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' })
        template.push({ label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' })
        template.push({ label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' })
        template.push({ type: 'separator' })
        template.push({ label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectAll' })
      }

      // Common items
      template.push({ type: 'separator' })
      template.push({ label: 'Reload', accelerator: 'CmdOrCtrl+R', role: 'reload' })
      template.push({ label: 'Back', accelerator: 'Alt+Left', click: () => view.webContents.goBack() })
      template.push({ label: 'Forward', accelerator: 'Alt+Right', click: () => view.webContents.goForward() })
      template.push({ type: 'separator' })
      template.push({ label: 'Inspect Element', accelerator: 'CmdOrCtrl+Shift+I', role: 'toggleDevTools' })

      if (template.length > 0) {
        Menu.buildFromTemplate(template).popup({ window: this.window })
      }
    })

    view.webContents.on('did-start-navigation', (_event, url, _isInPlace, isMainFrame) => {
      info.url = view.webContents.getURL()
      info.isLoading = true
      // The moment the active tab leaves about:blank — by the user, a link, or
      // the agent's CDP navigation — it stops being a "new tab": reveal its
      // native view so the controlled page is actually visible.
      if (isMainFrame && this.isRealUrl(url) && info.isNewTab) {
        info.isNewTab = false
        if (this.activeTabId === id) {
          if (!this.overlayActive) view.setVisible(true)
          this.layoutActiveTab()
        }
      }
      this.emitUpdate()
    })

    view.webContents.on('did-navigate', (_event, url) => {
      info.url = view.webContents.getURL()
      info.isLoading = false
      info.canGoBack = view.webContents.navigationHistory.canGoBack()
      info.canGoForward = view.webContents.navigationHistory.canGoForward()
      if (this.isRealUrl(url) && info.isNewTab) {
        info.isNewTab = false
        if (this.activeTabId === id) {
          if (!this.overlayActive) view.setVisible(true)
          this.layoutActiveTab()
        }
      }
      this.emitUpdate()

      // A login form was submitted on the previous page: offer its credentials
      // to the vault now that we know the login succeeded (navigation happened).
      void view.webContents
        .executeJavaScript(readCaptureScript(), true)
        .then((raw) => {
          if (!raw || !getSettings().savePasswords) return
          const data = JSON.parse(String(raw)) as { u?: string; p?: string }
          const result = this.vault.save(url, String(data.u || ''), String(data.p || ''))
          if (result === 'saved' || result === 'updated') {
            PasswordVault.notifySaved(PasswordVault.originOf(url), result)
          }
        })
        .catch(() => { /* not a page we can read */ })
    })

    view.webContents.on('dom-ready', () => {
      const settings = getSettings()
      try {
        view.webContents.setZoomFactor(settings.defaultZoom)
      } catch { /* detached */ }
      if (settings.autoSignin) {
        const url = view.webContents.getURL()
        if (url.startsWith('https://')) {
          const creds = this.vault.findForOrigin(url)
          if (creds) {
            void view.webContents.executeJavaScript(autofillScript(creds), true).catch(() => {})
          }
        }
      }
      if (settings.savePasswords) {
        void view.webContents.executeJavaScript(CAPTURE_HOOK, true).catch(() => {})
      }
    })

    view.webContents.on('page-title-updated', (_event, title) => {
      info.title = title || 'Untitled'
      this.emitUpdate()
    })

    view.webContents.on('did-start-loading', () => {
      info.isLoading = true
      this.emitUpdate()
    })

    view.webContents.on('did-stop-loading', () => {
      info.isLoading = false
      this.emitUpdate()
    })

    view.webContents.on('page-favicon-updated', (_event, favicons) => {
      if (favicons.length > 0) {
        info.favicon = favicons[0]
        this.emitUpdate()
      }
    })

    view.webContents.on('render-process-gone', (_event, details) => {
      console.error(`Tab ${id} render process gone:`, details.reason)
    })

    view.webContents.setWindowOpenHandler(() => {
      return { action: 'deny' }
    })
  }

  switchToTab(tabId: string): boolean {
    const entry = this.tabs.get(tabId)
    if (!entry) return false

    if (this.activeTabId) {
      const current = this.tabs.get(this.activeTabId)
      if (current) {
        current.info.isActive = false
        current.view.setVisible(false)
      }
    }

    entry.info.isActive = true
    // New tabs render the React dashboard, so their native view stays hidden.
    // While an overlay is open the page view stays hidden regardless.
    entry.view.setVisible(this.overlayActive ? false : !entry.info.isNewTab)
    this.activeTabId = tabId

    this.layoutActiveTab()
    this.emitUpdate()
    return true
  }

  closeTab(tabId: string): boolean {
    const entry = this.tabs.get(tabId)
    if (!entry) return false

    entry.view.setVisible(false)
    this.window.contentView.removeChildView(entry.view)
    entry.view.webContents.close()
    this.tabs.delete(tabId)

    if (this.activeTabId === tabId) {
      const remaining = Array.from(this.tabs.keys())
      if (remaining.length > 0) {
        this.switchToTab(remaining[remaining.length - 1])
      } else {
        this.activeTabId = null
      }
    }

    this.emitUpdate()
    return true
  }

  navigateTab(tabId: string, url: string): void {
    const entry = this.tabs.get(tabId)
    if (!entry) return

    // Security: never let tabs navigate to local/sensitive schemes — a page
    // could otherwise prompt-inject the agent into reading local files.
    if (/^(\s)*(file|chrome|chrome-extension|devtools|view-source|javascript|vbscript|blob):/i.test(url.trim())) return

    let targetUrl = url
    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:') && !url.startsWith('data:')) {
      if (url.includes('.') && !url.includes(' ')) {
        targetUrl = `https://${url}`
      } else {
        const s = getSettings()
        targetUrl = buildSearchUrl(s.searchEngine, s.customSearchUrl, url)
      }
    }

    // Leaving the new-tab dashboard: reveal the native view for the real page.
    entry.info.isNewTab = false
    if (this.activeTabId === tabId) {
      if (!this.overlayActive) entry.view.setVisible(true)
      this.layoutActiveTab()
    }

    entry.view.webContents.loadURL(targetUrl)
  }

  reloadTab(tabId: string): void {
    const entry = this.tabs.get(tabId)
    if (entry) entry.view.webContents.reload()
  }

  goBack(tabId: string): void {
    const entry = this.tabs.get(tabId)
    if (entry && entry.view.webContents.navigationHistory.canGoBack()) {
      entry.view.webContents.navigationHistory.goBack()
    }
  }

  goForward(tabId: string): void {
    const entry = this.tabs.get(tabId)
    if (entry && entry.view.webContents.navigationHistory.canGoForward()) {
      entry.view.webContents.navigationHistory.goForward()
    }
  }

  stopTab(tabId: string): void {
    const entry = this.tabs.get(tabId)
    if (entry) entry.view.webContents.stop()
  }

  moveTab(fromIndex: number, toIndex: number): void {
    const ids = Array.from(this.tabs.keys())
    if (fromIndex < 0 || fromIndex >= ids.length || toIndex < 0 || toIndex >= ids.length) return

    const [movedId] = ids.splice(fromIndex, 1)
    ids.splice(toIndex, 0, movedId)

    const reordered = new Map<string, TabEntry>()
    for (const id of ids) {
      reordered.set(id, this.tabs.get(id)!)
    }
    this.tabs = reordered
    this.emitUpdate()
  }

  getTab(tabId: string): TabEntry | undefined {
    return this.tabs.get(tabId)
  }

  getActiveTab(): TabEntry | null {
    if (!this.activeTabId) return null
    return this.tabs.get(this.activeTabId) || null
  }

  getActiveTabId(): string | null {
    return this.activeTabId
  }

  getTabList(): TabInfo[] {
    return Array.from(this.tabs.values()).map((t) => ({ ...t.info }))
  }

  /** A URL that represents a real destination (anything beyond the blank new-tab page). */
  private isRealUrl(url: string | undefined): boolean {
    if (!url) return false
    if (url === 'about:blank') return false
    if (url.startsWith('about:') || url.startsWith('data:')) return false
    return true
  }

  /** Explicitly reveal the active tab's native view if it's still in new-tab state. */
  revealActiveTab(): void {
    if (!this.activeTabId) return
    const entry = this.tabs.get(this.activeTabId)
    if (!entry) return
    if (entry.info.isNewTab) {
      entry.info.isNewTab = false
      if (!this.overlayActive) entry.view.setVisible(true)
      this.layoutActiveTab()
      this.emitUpdate()
    }
  }

  layoutActiveTab(): void {
    if (!this.activeTabId) return
    const entry = this.tabs.get(this.activeTabId)
    if (!entry || entry.info.isNewTab) return

    const bounds = this.window.getContentBounds()
    entry.view.setBounds({
      x: 0,
      y: CHROME_HEIGHT,
      width: Math.max(0, bounds.width - this.rightInset),
      height: Math.max(0, bounds.height - CHROME_HEIGHT)
    })
  }

  destroyAll(): void {
    for (const entry of this.tabs.values()) {
      entry.view.webContents.close()
    }
    this.tabs.clear()
    this.activeTabId = null
  }

  executeJSInActiveTab(code: string): Promise<unknown> {
    const active = this.getActiveTab()
    if (!active) throw new Error('No active tab')
    return active.view.webContents.executeJavaScript(code)
  }

  getActiveTabWebContents() {
    const active = this.getActiveTab()
    return active?.view.webContents || null
  }

  /** Per-tab sessions get download handling, DNT and friends exactly once. */
  private configureSession(ses: Session): void {
    if (this.configuredSessions.has(ses)) return
    this.configuredSessions.add(ses)

    // Sites sniff the UA and serve Electron a degraded/no-CSS experience.
    // Present the stock Chrome UA (same engine) for full-fidelity pages.
    const ua = ses.getUserAgent()
    const chromeUa = ua
      .replace(/\s*agentic-browser\/[\d.]+/i, '')
      .replace(/\s*Electron\/[\d.]+/i, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
    ses.setUserAgent(chromeUa)

    ses.on('will-download', (_event, item) => {
      const settings = getSettings()
      const downloadId = crypto.randomUUID()
      const download: DownloadItem = {
        id: downloadId,
        filename: item.getFilename(),
        url: item.getURL(),
        status: 'downloading',
        progress: 0,
        totalBytes: item.getTotalBytes(),
        receivedBytes: 0,
        startTime: Date.now()
      }
      this.downloads.unshift(download)
      if (this.downloads.length > 100) this.downloads.length = 100
      this.emitDownloads()

      try {
        if (settings.askDownloadLocation) {
          const res = dialog.showSaveDialogSync(this.window, {
            defaultPath: path.join(settings.downloadPath || app.getPath('downloads'), item.getFilename())
          })
          if (!res) {
            item.cancel()
            download.status = 'cancelled'
            this.emitDownloads()
            return
          }
          item.setSavePath(res)
        } else {
          item.setSavePath(path.join(settings.downloadPath || app.getPath('downloads'), item.getFilename()))
        }
      } catch { /* fall back to Chromium default handling */ }

      item.on('updated', (_event, state) => {
        if (state === 'progressing') {
          download.receivedBytes = item.getReceivedBytes()
          download.totalBytes = item.getTotalBytes()
          download.progress = download.totalBytes > 0 ? download.receivedBytes / download.totalBytes : 0
          this.emitDownloads()
        }
      })

      item.once('done', (_event, state) => {
        if (state === 'completed') {
          download.status = 'completed'
          download.progress = 1
        } else {
          download.status = state === 'cancelled' ? 'cancelled' : 'interrupted'
        }
        download.receivedBytes = item.getReceivedBytes()
        this.emitDownloads()
      })
    })

    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      const requestHeaders = details.requestHeaders
      if (getSettings().doNotTrack) requestHeaders['DNT'] = '1'
      callback({ requestHeaders })
    })
  }

  async clearBrowsingData(kinds: { cache: boolean; cookies: boolean }): Promise<void> {
    const sessions = new Set<Session>()
    for (const entry of this.tabs.values()) sessions.add(entry.view.webContents.session)
    sessions.add(electronSession.defaultSession)
    for (const ses of sessions) {
      if (kinds.cache) await ses.clearCache()
      if (kinds.cookies) {
        await ses.clearStorageData({
          storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage']
        })
      }
    }
  }

  getPasswordVault(): PasswordVault {
    return this.vault
  }

  /** Real (http/https) URLs of open tabs — used for session restore. */
  getSessionUrls(): string[] {
    return this.getTabList()
      .filter((t) => !t.isNewTab && /^https?:\/\//.test(t.url))
      .map((t) => t.url)
  }

  private emitUpdate(): void {
    if (this.onTabUpdate) {
      this.onTabUpdate(this.getTabList(), this.activeTabId)
    }
  }

  private emitDownloads(): void {
    if (this.onDownloadUpdate) {
      this.onDownloadUpdate([...this.downloads])
    }
  }
}
