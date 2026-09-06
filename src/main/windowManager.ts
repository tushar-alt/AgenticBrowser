import { BaseWindow, WebContentsView, nativeTheme, session } from 'electron'
import path from 'path'
import Store from 'electron-store'
import { TabManager } from './tabManager'
import { setupIPCHandlers } from './ipcHandlers'
import { IPC_CHANNELS } from '@shared/types'
import { getSettings } from './services/AppSettingsStore'
import { TAB_STRIP_HEIGHT } from '@shared/constants'

let mainWindow: BaseWindow | null = null
let tabManager: TabManager | null = null
let rendererView: WebContentsView | null = null

const lastSessionStore = new Store<{ urls: string[] }>({ name: 'last-session', defaults: { urls: [] } })

export function getMainWindow(): BaseWindow | null {
  return mainWindow
}

export function getTabManager(): TabManager | null {
  return tabManager
}

export function getRendererWebContents() {
  return rendererView?.webContents || null
}

/** The renderer (React chrome) fills the whole content area; tab views overlay it. */
function layoutRendererView(): void {
  if (!mainWindow || !rendererView) return
  const bounds = mainWindow.getContentBounds()
  rendererView.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height })
}

export function createMainWindow(): BaseWindow {
  nativeTheme.themeSource = 'dark'

  mainWindow = new BaseWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0e0e10',
      symbolColor: '#f2efe6',
      height: TAB_STRIP_HEIGHT
    },
    backgroundColor: '#0e0e10',
    show: false
  })

  rendererView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // Content Security Policy for the renderer — restricts script/connect sources
  // to self + localhost (for AI provider APIs and MCP server).
  const CSP = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' http://localhost:* https://localhost:* ws://localhost:*",
    "child-src 'self' blob:",
    "worker-src 'self' blob:",
    "form-action 'self'"
  ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.url.startsWith('http://localhost:') || details.url.startsWith('https://localhost:')) {
      callback({ responseHeaders: { ...details.responseHeaders } })
    } else {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [CSP]
        }
      })
    }
  })

  mainWindow.contentView.addChildView(rendererView)
  layoutRendererView()

  if (process.env.ELECTRON_RENDERER_URL) {
    rendererView.webContents.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    rendererView.webContents.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  tabManager = new TabManager(mainWindow)

  // App shortcuts captured on web pages: tab actions run here, chrome-UI
  // actions are forwarded to the React renderer (after refocusing it, since
  // the page owns keyboard focus while visible).
  tabManager.setShortcutCallback((combo) => {
    if (combo === 'mod+t') {
      tabManager!.createTab()
      return
    }
    if (combo === 'mod+w') {
      const id = tabManager!.getActiveTabId()
      if (id) tabManager!.closeTab(id)
      return
    }
    if (!rendererView) return
    rendererView.webContents.focus()
    rendererView.webContents.send(IPC_CHANNELS.UI_SHORTCUT, combo)
  })

  rendererView.webContents.on('did-finish-load', () => {
    layoutRendererView()
    mainWindow!.show()
    const lastUrls = lastSessionStore.get('urls', [])
    if (getSettings().restoreSession && lastUrls.length > 0) {
      lastUrls.forEach((u) => tabManager!.createTab(u))
    } else {
      tabManager!.createTab()
    }
  })

  // Persist open tabs before the window goes away so "continue where you
  // left off" has something to restore next launch.
  mainWindow.on('close', () => {
    try {
      if (tabManager) lastSessionStore.set('urls', tabManager.getSessionUrls())
    } catch { /* best effort */ }
  })

  mainWindow.on('closed', () => {
    tabManager?.destroyAll()
    mainWindow = null
    tabManager = null
    rendererView = null
  })

  mainWindow.on('resize', () => {
    layoutRendererView()
    tabManager?.layoutActiveTab()
  })

  setupIPCHandlers()

  return mainWindow
}
