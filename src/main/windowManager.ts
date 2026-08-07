import { BaseWindow, WebContentsView, nativeTheme } from 'electron'
import path from 'path'
import { TabManager } from './tabManager'
import { setupIPCHandlers } from './ipcHandlers'
import { TAB_STRIP_HEIGHT } from '@shared/constants'

let mainWindow: BaseWindow | null = null
let tabManager: TabManager | null = null
let rendererView: WebContentsView | null = null

export function getMainWindow(): BaseWindow | null {
  return mainWindow
}

export function getTabManager(): TabManager | null {
  return tabManager
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

  mainWindow.contentView.addChildView(rendererView)
  layoutRendererView()

  if (process.env.ELECTRON_RENDERER_URL) {
    rendererView.webContents.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    rendererView.webContents.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  tabManager = new TabManager(mainWindow)

  rendererView.webContents.on('did-finish-load', () => {
    layoutRendererView()
    mainWindow!.show()
    tabManager!.createTab()
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
