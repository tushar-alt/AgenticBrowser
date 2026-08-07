import { ipcMain, WebContentsView } from 'electron'
import { getMainWindow, getTabManager } from './windowManager'
import { SecureStorage } from './services/SecureStorage'
import { AIClient } from './services/AIClient'
import { CDPController } from './services/CDPController'
import { AgentOrchestrator } from './services/AgentOrchestrator'
import { ContentExtractor } from './services/ContentExtractor'
import { MCPServer } from './services/MCPServer'
import Store from 'electron-store'
import { AppSettings, IPC_CHANNELS, ChatMessage, VisionImage, HistoryEntry, Bookmark } from '@shared/types'

const secureStorage = new SecureStorage()
const aiClient = new AIClient(secureStorage)
const cdpController = new CDPController()
const contentExtractor = new ContentExtractor()
let agentOrchestrator: AgentOrchestrator | null = null
let mcpServer: MCPServer | null = null

const settingsStore: AppSettings = {
  aiProvider: secureStorage.getActiveProvider(),
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

const historyStore = new Store<{ history: HistoryEntry[] }>({ name: 'history', defaults: { history: [] } })
const bookmarkStore = new Store<{ bookmarks: Bookmark[] }>({ name: 'bookmarks', defaults: { bookmarks: [] } })

function sendToRenderer(channel: string, ...args: unknown[]): void {
  const win = getMainWindow()
  if (win) {
    const allViews = win.contentView.children
    const rendererView = allViews[0] as WebContentsView
    if (rendererView) {
      rendererView.webContents.send(channel, ...args)
    }
  }
}

export function setupIPCHandlers(): void {
  const tabManager = getTabManager()
  if (!tabManager) return

  tabManager.setTabUpdateCallback((tabs, activeId) => {
    sendToRenderer(IPC_CHANNELS.TAB_UPDATE, tabs, activeId)
  })

  ipcMain.handle(IPC_CHANNELS.TAB_CREATE, (_event, url?: string) => {
    return tabManager.createTab(url)
  })

  ipcMain.handle(IPC_CHANNELS.TAB_CLOSE, (_event, tabId: string) => {
    return tabManager.closeTab(tabId)
  })

  ipcMain.handle(IPC_CHANNELS.TAB_SWITCH, (_event, tabId: string) => {
    return tabManager.switchToTab(tabId)
  })

  ipcMain.handle(IPC_CHANNELS.TAB_NAVIGATE, (_event, tabId: string, url: string) => {
    tabManager.navigateTab(tabId, url)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.TAB_RELOAD, (_event, tabId: string) => {
    tabManager.reloadTab(tabId)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.TAB_BACK, (_event, tabId: string) => {
    tabManager.goBack(tabId)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.TAB_FORWARD, (_event, tabId: string) => {
    tabManager.goForward(tabId)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.TAB_STOP, (_event, tabId: string) => {
    tabManager.stopTab(tabId)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.TAB_LIST, () => {
    return tabManager.getTabList()
  })

  ipcMain.handle(IPC_CHANNELS.TAB_MOVED, (_event, fromIndex: number, toIndex: number) => {
    tabManager.moveTab(fromIndex, toIndex)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => {
    return { ...settingsStore, apiKey: '' }
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, (_event, settings: Partial<AppSettings>) => {
    if (settings.apiKey && settings.aiProvider) {
      secureStorage.saveKey(settings.aiProvider, settings.apiKey, settings.baseURL, settings.model)
    }
    if (settings.aiProvider) {
      settingsStore.aiProvider = settings.aiProvider
      secureStorage.setActiveProvider(settings.aiProvider)
    }
    if (settings.baseURL !== undefined) settingsStore.baseURL = settings.baseURL
    if (settings.model !== undefined) settingsStore.model = settings.model
    if (settings.approvalMode) settingsStore.approvalMode = settings.approvalMode
    if (settings.maxAgentSteps) settingsStore.maxAgentSteps = settings.maxAgentSteps
    if (settings.agentTimeout) settingsStore.agentTimeout = settings.agentTimeout
    if (settings.theme) settingsStore.theme = settings.theme
    if (settings.showChatPanel !== undefined) settingsStore.showChatPanel = settings.showChatPanel
    if (settings.showSupervisor !== undefined) settingsStore.showSupervisor = settings.showSupervisor
    if (settings.mcpServerEnabled !== undefined) settingsStore.mcpServerEnabled = settings.mcpServerEnabled
    if (settings.mcpServerPort) settingsStore.mcpServerPort = settings.mcpServerPort

    return { ...settingsStore, apiKey: '' }
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_TEST_KEY, async () => {
    return aiClient.testConnection()
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_KEY_STATUS, () => {
    return secureStorage.getProviderStatus()
  })

  ipcMain.handle(IPC_CHANNELS.AGENT_START, async (_event, goal: string) => {
    if (!agentOrchestrator) {
      agentOrchestrator = new AgentOrchestrator(aiClient, cdpController, contentExtractor, tabManager)
    }

    // Wire approval mode from settings
    agentOrchestrator.setApprovalMode(settingsStore.approvalMode)

    agentOrchestrator.removeAllListeners()
    agentOrchestrator.on('status', (task) => {
      sendToRenderer(IPC_CHANNELS.AGENT_STATUS, task)
    })
    agentOrchestrator.on('action', (action) => {
      sendToRenderer(IPC_CHANNELS.AGENT_ACTION_LOG, action)
    })
    agentOrchestrator.on('approval-request', (description: string) => {
      sendToRenderer(IPC_CHANNELS.AGENT_REQUEST_APPROVAL, description)
    })
    agentOrchestrator.on('debug-log', (log: string) => {
      sendToRenderer(IPC_CHANNELS.AGENT_DEBUG_LOG, log)
    })

    const task = await agentOrchestrator.startTask(goal)
    return task
  })

  ipcMain.handle(IPC_CHANNELS.AGENT_STOP, () => {
    agentOrchestrator?.stop()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.AGENT_PAUSE, () => {
    agentOrchestrator?.pause()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.AGENT_RESUME, () => {
    agentOrchestrator?.resume()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.AGENT_APPROVE, () => {
    agentOrchestrator?.approveAction()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.AGENT_DENY, () => {
    agentOrchestrator?.denyAction()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.AGENT_STATUS, () => {
    return agentOrchestrator?.getStatus() || { isRunning: false, isPaused: false, task: null }
  })

  ipcMain.handle(IPC_CHANNELS.CHAT_SEND, async (_event, messages: ChatMessage[]) => {
    const activeTab = tabManager.getActiveTab()
    let systemPrompt = 'You are a helpful AI assistant integrated into a web browser.'

    if (activeTab) {
      const webContents = activeTab.view.webContents
      try {
        const ctx = await contentExtractor.extractPageContext(webContents)
        systemPrompt += `\n\nCurrent page context:\nURL: ${ctx.url}\nTitle: ${ctx.title}\nContent preview:\n${ctx.textContent.substring(0, 3000)}`
      } catch {
        // Page context extraction failed, continue without it
      }
    }

    const response = await aiClient.sendMessage(messages, systemPrompt, {
      onToken: (token) => sendToRenderer(IPC_CHANNELS.CHAT_STREAM, token),
      onComplete: (fullText) => sendToRenderer(IPC_CHANNELS.CHAT_RESPONSE, fullText),
      onError: (error) => sendToRenderer(IPC_CHANNELS.CHAT_RESPONSE, `Error: ${error}`)
    })

    return response
  })

  ipcMain.handle(IPC_CHANNELS.CHAT_SUMMARIZE, async () => {
    const activeTab = tabManager.getActiveTab()
    if (!activeTab) return 'No active tab to summarize.'

    const webContents = activeTab.view.webContents
    const ctx = await contentExtractor.extractPageContext(webContents)

    const messages: ChatMessage[] = [
      {
        id: 'summarize',
        role: 'user',
        content: `Please summarize the following web page:\n\nTitle: ${ctx.title}\nURL: ${ctx.url}\n\nContent:\n${ctx.textContent.substring(0, 8000)}`,
        timestamp: Date.now()
      }
    ]

    return aiClient.sendMessage(messages, 'You are a helpful assistant. Provide clear, concise summaries.')
  })

  ipcMain.handle(IPC_CHANNELS.CHAT_EXPLAIN, async () => {
    const activeTab = tabManager.getActiveTab()
    if (!activeTab) return 'No active tab.'

    const webContents = activeTab.view.webContents
    const selectedText = await webContents.executeJavaScript(`window.getSelection()?.toString() || ''`)

    if (!selectedText) return 'No text selected. Select some text on the page first.'

    const messages: ChatMessage[] = [
      {
        id: 'explain',
        role: 'user',
        content: `Explain the following text clearly and concisely:\n\n"${selectedText}"`,
        timestamp: Date.now()
      }
    ]

    return aiClient.sendMessage(messages, 'You are a helpful assistant. Explain things clearly.')
  })

  ipcMain.handle(IPC_CHANNELS.CHAT_VISION, async (_event, question: string) => {
    const activeTab = tabManager.getActiveTab()
    if (!activeTab) return 'No active tab.'

    const tabId = activeTab.id
    const webContents = activeTab.view.webContents

    // Capture screenshot
    let screenshotData: string | null = null
    if (!cdpController.isAttached(tabId)) {
      cdpController.attach(tabId, webContents)
    }
    try {
      screenshotData = await cdpController.screenshot(tabId)
    } catch {
      // Screenshot failed, continue without it
    }

    // Build system prompt with page context
    let systemPrompt = 'You are a helpful AI assistant with vision capabilities integrated into a web browser. You can see a screenshot of the current page. Use visual information to answer questions about the page layout, content, and appearance.'
    try {
      const ctx = await contentExtractor.extractPageContext(webContents)
      systemPrompt += `\n\nCurrent page context:\nURL: ${ctx.url}\nTitle: ${ctx.title}\nContent preview:\n${ctx.textContent.substring(0, 3000)}`
    } catch {
      // Page context extraction failed, continue without it
    }

    const messages: ChatMessage[] = [
      {
        id: 'vision-chat',
        role: 'user',
        content: question,
        timestamp: Date.now()
      }
    ]

    if (screenshotData) {
      const images: VisionImage[] = [{ data: screenshotData, mimeType: 'image/png' }]
      const response = await aiClient.sendVisionMessage(messages, images, systemPrompt, {
        onToken: (token) => sendToRenderer(IPC_CHANNELS.CHAT_STREAM, token),
        onComplete: (fullText) => sendToRenderer(IPC_CHANNELS.CHAT_RESPONSE, fullText),
        onError: (error) => sendToRenderer(IPC_CHANNELS.CHAT_RESPONSE, `Error: ${error}`)
      })
      return response
    }

    // Fallback to text-only if screenshot failed
    const response = await aiClient.sendMessage(messages, systemPrompt, {
      onToken: (token) => sendToRenderer(IPC_CHANNELS.CHAT_STREAM, token),
      onComplete: (fullText) => sendToRenderer(IPC_CHANNELS.CHAT_RESPONSE, fullText),
      onError: (error) => sendToRenderer(IPC_CHANNELS.CHAT_RESPONSE, `Error: ${error}`)
    })
    return response
  })

  ipcMain.handle(IPC_CHANNELS.PAGE_CONTEXT, async () => {
    const activeTab = tabManager.getActiveTab()
    if (!activeTab) return null
    return contentExtractor.extractPageContext(activeTab.view.webContents)
  })

  ipcMain.handle(IPC_CHANNELS.PAGE_SCREENSHOT, async () => {
    const activeTab = tabManager.getActiveTab()
    if (!activeTab) return null
    const tabId = activeTab.id
    const webContents = activeTab.view.webContents
    if (!cdpController.isAttached(tabId)) {
      cdpController.attach(tabId, webContents)
    }
    return cdpController.screenshot(tabId)
  })

  ipcMain.handle(IPC_CHANNELS.MCP_STATUS, async (_event, enabled?: boolean, port?: number) => {
    if (enabled !== undefined) {
      if (enabled && !mcpServer) {
        mcpServer = new MCPServer(cdpController, contentExtractor, tabManager, port || settingsStore.mcpServerPort)
        await mcpServer.start()
      } else if (!enabled && mcpServer) {
        await mcpServer.stop()
        mcpServer = null
      }
    }
    return mcpServer?.getStatus() || { running: false, port: settingsStore.mcpServerPort }
  })

  ipcMain.handle(IPC_CHANNELS.NAV_URL_CHANGED, (_event, tabId: string, url: string) => {
    sendToRenderer(IPC_CHANNELS.NAV_URL_CHANGED, tabId, url)
  })

  ipcMain.handle(IPC_CHANNELS.COMMAND_PALETTE_TOGGLE, () => {
    sendToRenderer(IPC_CHANNELS.COMMAND_PALETTE_TOGGLE)
  })

  ipcMain.handle(IPC_CHANNELS.LAYOUT_INSETS, (_event, right: number) => {
    tabManager.setRightInset(right)
    return true
  })

  // ── History & Bookmarks ────────────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.HISTORY_ADD, (_event, entry: HistoryEntry) => {
    const history = historyStore.get('history', [])
    // Deduplicate by url
    const filtered = history.filter((h) => h.url !== entry.url)
    const updated = [entry, ...filtered].slice(0, 5000)
    historyStore.set('history', updated)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.HISTORY_GET, () => {
    return historyStore.get('history', [])
  })

  ipcMain.handle(IPC_CHANNELS.HISTORY_REMOVE, (_event, id: string) => {
    const history = historyStore.get('history', [])
    historyStore.set('history', history.filter((h) => h.id !== id))
    return true
  })

  ipcMain.handle(IPC_CHANNELS.HISTORY_CLEAR, () => {
    historyStore.set('history', [])
    return true
  })

  ipcMain.handle(IPC_CHANNELS.BOOKMARK_ADD, (_event, bookmark: Bookmark) => {
    const bookmarks = bookmarkStore.get('bookmarks', [])
    // Prevent duplicates by url
    if (!bookmarks.some((b) => b.url === bookmark.url)) {
      bookmarkStore.set('bookmarks', [...bookmarks, bookmark])
    }
    return true
  })

  ipcMain.handle(IPC_CHANNELS.BOOKMARK_REMOVE, (_event, id: string) => {
    const bookmarks = bookmarkStore.get('bookmarks', [])
    bookmarkStore.set('bookmarks', bookmarks.filter((b) => b.id !== id))
    return true
  })

  ipcMain.handle(IPC_CHANNELS.BOOKMARK_GET, () => {
    return bookmarkStore.get('bookmarks', [])
  })

  ipcMain.handle(IPC_CHANNELS.BOOKMARK_IS_BOOKMARKED, (_event, url: string) => {
    const bookmarks = bookmarkStore.get('bookmarks', [])
    return bookmarks.some((b) => b.url === url)
  })

  // ── Find in Page ──────────────────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.FIND_IN_PAGE, (_event, searchText: string, options?: { findNext?: boolean }) => {
    const webContents = tabManager.getActiveTabWebContents()
    if (!webContents) return null

    // Set up the found-in-page listener to relay results back to the renderer.
    const onFoundInPage = (_event: unknown, result: Electron.Result) => {
      sendToRenderer(IPC_CHANNELS.FIND_RESULT, {
        requestId: result.requestId,
        activeMatchOrdinal: result.activeMatchOrdinal,
        matches: result.matches,
        selectionArea: result.selectionArea,
        finalUpdate: result.finalUpdate
      })
    }

    // Remove previous listener to avoid duplicates, then attach a fresh one.
    webContents.removeAllListeners('found-in-page')
    webContents.on('found-in-page', onFoundInPage)

    if (searchText) {
      webContents.findInPage(searchText, options)
    }
    return true
  })

  ipcMain.handle(IPC_CHANNELS.FIND_NEXT, (_event, searchText: string) => {
    const webContents = tabManager.getActiveTabWebContents()
    if (!webContents || !searchText) return null
    webContents.findInPage(searchText, { findNext: true })
    return true
  })

  ipcMain.handle(IPC_CHANNELS.FIND_PREVIOUS, (_event, searchText: string) => {
    const webContents = tabManager.getActiveTabWebContents()
    if (!webContents || !searchText) return null
    webContents.findInPage(searchText, { forward: false })
    return true
  })

  ipcMain.handle(IPC_CHANNELS.FIND_STOP, () => {
    const webContents = tabManager.getActiveTabWebContents()
    if (!webContents) return null
    webContents.stopFindInPage('keepSelection')
    webContents.removeAllListeners('found-in-page')
    return true
  })

  // ── Tab Persistence ─────────────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.TABS_SAVE, () => {
    const tabs = tabManager.getTabList()
    const savedTabs = tabs
      .filter((t) => !t.isNewTab && t.url !== 'about:blank')
      .map((t) => ({ url: t.url, title: t.title }))
    const store = new Store<{ savedTabs: Array<{ url: string; title: string }> }>({
      name: 'agentic-browser-tabs',
      defaults: { savedTabs: [] }
    })
    store.set('savedTabs', savedTabs)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.TABS_RESTORE, () => {
    const store = new Store<{ savedTabs: Array<{ url: string; title: string }> }>({
      name: 'agentic-browser-tabs',
      defaults: { savedTabs: [] }
    })
    const savedTabs = store.get('savedTabs', [])
    for (const tab of savedTabs) {
      tabManager.createTab(tab.url)
    }
    return true
  })

  // ── Custom Shortcuts ────────────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.SHORTCUTS_GET, () => {
    const store = new Store<{ shortcuts: Array<{ id: string; label: string; url: string; tint: string }> }>({
      name: 'agentic-browser-shortcuts',
      defaults: {
        shortcuts: [
          { id: '1', label: 'GitHub', url: 'https://github.com', tint: '#6e7681' },
          { id: '2', label: 'Gmail', url: 'https://mail.google.com', tint: '#ea4335' },
          { id: '3', label: 'YouTube', url: 'https://youtube.com', tint: '#ff0033' },
          { id: '4', label: 'Hacker News', url: 'https://news.ycombinator.com', tint: '#ff6600' },
          { id: '5', label: 'Wikipedia', url: 'https://wikipedia.org', tint: '#9b9aa3' },
          { id: '6', label: 'Reddit', url: 'https://reddit.com', tint: '#ff4500' }
        ]
      }
    })
    return store.get('shortcuts', [])
  })

  ipcMain.handle(IPC_CHANNELS.SHORTCUTS_SET, (_event, shortcuts: Array<{ id: string; label: string; url: string; tint: string }>) => {
    const store = new Store<{ shortcuts: Array<{ id: string; label: string; url: string; tint: string }> }>({
      name: 'agentic-browser-shortcuts',
      defaults: { shortcuts: [] }
    })
    store.set('shortcuts', shortcuts)
    return true
  })

  // ── Workflows ───────────────────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.WORKFLOW_LIST, () => {
    const store = new Store<{ workflows: Array<{ id: string; name: string; steps: unknown[]; createdAt: number }> }>({
      name: 'agentic-browser-workflows',
      defaults: { workflows: [] }
    })
    return store.get('workflows', [])
  })

  ipcMain.handle(IPC_CHANNELS.WORKFLOW_SAVE, (_event, workflow: { id: string; name: string; steps: unknown[]; createdAt: number }) => {
    const store = new Store<{ workflows: Array<{ id: string; name: string; steps: unknown[]; createdAt: number }> }>({
      name: 'agentic-browser-workflows',
      defaults: { workflows: [] }
    })
    const workflows = store.get('workflows', [])
    const existing = workflows.findIndex((w) => w.id === workflow.id)
    if (existing >= 0) {
      workflows[existing] = workflow
    } else {
      workflows.push(workflow)
    }
    store.set('workflows', workflows)
    return true
  })

  ipcMain.handle(IPC_CHANNELS.WORKFLOW_RUN, async (_event, workflowId: string) => {
    const store = new Store<{ workflows: Array<{ id: string; name: string; steps: Array<{ description: string }>; createdAt: number }> }>({
      name: 'agentic-browser-workflows',
      defaults: { workflows: [] }
    })
    const workflows = store.get('workflows', [])
    const workflow = workflows.find((w) => w.id === workflowId)
    if (!workflow) throw new Error('Workflow not found')

    const goal = `Execute saved workflow "${workflow.name}": ${workflow.steps.map((s) => s.description).join(', ')}`
    if (!agentOrchestrator) {
      agentOrchestrator = new AgentOrchestrator(aiClient, cdpController, contentExtractor, tabManager)
    }
    agentOrchestrator.setApprovalMode(settingsStore.approvalMode)
    agentOrchestrator.removeAllListeners()
    agentOrchestrator.on('status', (task) => sendToRenderer(IPC_CHANNELS.AGENT_STATUS, task))
    agentOrchestrator.on('action', (action) => sendToRenderer(IPC_CHANNELS.AGENT_ACTION_LOG, action))
    agentOrchestrator.on('approval-request', (desc: string) => sendToRenderer(IPC_CHANNELS.AGENT_REQUEST_APPROVAL, desc))

    return agentOrchestrator.startTask(goal)
  })

  // ── Theme ───────────────────────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.THEME_GET, () => {
    return settingsStore.theme
  })

  ipcMain.handle(IPC_CHANNELS.THEME_SET, (_event, theme: 'dark' | 'light') => {
    settingsStore.theme = theme
    try {
      const { nativeTheme } = require('electron')
      nativeTheme.themeSource = theme
    } catch {
      // nativeTheme may not be available in all contexts
    }
    sendToRenderer(IPC_CHANNELS.THEME_SET, theme)
    return true
  })
}
