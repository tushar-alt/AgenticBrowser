import { ipcMain, nativeTheme, dialog, shell, WebContentsView } from 'electron'
import { getMainWindow, getTabManager } from './windowManager'
import { SecureStorage } from './services/SecureStorage'
import { AIClient } from './services/AIClient'
import { OAuthAccounts, type OAuthKind } from './services/OAuthAccounts'
import { CDPController } from './services/CDPController'
import { AgentOrchestrator } from './services/AgentOrchestrator'
import { ContentExtractor } from './services/ContentExtractor'
import { MCPServer } from './services/MCPServer'
import { getSettings, updateSettings } from './services/AppSettingsStore'
import Store from 'electron-store'
import { AppSettings, IPC_CHANNELS, ChatMessage, VisionImage, HistoryEntry, Bookmark } from '@shared/types'

const secureStorage = new SecureStorage()
const oauthAccounts = new OAuthAccounts()
const aiClient = new AIClient(secureStorage, oauthAccounts)
const cdpController = new CDPController()
const contentExtractor = new ContentExtractor()
let agentOrchestrator: AgentOrchestrator | null = null
let mcpServer: MCPServer | null = null

const settingsStore: AppSettings = getSettings()

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

  ipcMain.handle(IPC_CHANNELS.TAB_CREATE, (_event, url?: string, incognito?: boolean) => {
    return tabManager.createTab(url, incognito)
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
    // ISSUE 2 (root cause): the ACTIVE provider must follow selection even
    // when no API key is involved (Ollama / subscription sign-ins), otherwise
    // AIClient keeps using the previously stored provider.
    if (settings.aiProvider) {
      secureStorage.setActiveProvider(settings.aiProvider)
    }
    delete settings.apiKey
    if (settings.theme) {
      nativeTheme.themeSource = settings.theme
    }
    // Persist everything the user changed; the local object stays in sync so
    // other main-process reads (agent, tab sessions) see current values.
    Object.assign(settingsStore, updateSettings(settings))
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

  ipcMain.handle(IPC_CHANNELS.LAYOUT_OVERLAY, (_event, active: boolean) => {
    tabManager.setOverlayActive(active)
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

  // ── Downloads ────────────────────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_LIST, () => {
    return tabManager.getDownloads()
  })

  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_CLEAR, () => {
    tabManager['downloads'] = []
    tabManager['emitDownloads']()
    return true
  })

  // Set up download updates forwarding
  tabManager.setDownloadUpdateCallback((downloads) => {
    sendToRenderer(IPC_CHANNELS.DOWNLOAD_UPDATE, downloads)
  })

  // ── Reader Mode ──────────────────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.READER_TOGGLE, async () => {
    const webContents = tabManager.getActiveTabWebContents()
    if (!webContents) return false

    // Check if reader mode is already active
    const isReaderActive = await webContents.executeJavaScript(`
      !!document.getElementById('ab-reader-overlay')
    `).catch(() => false)

    if (isReaderActive) {
      // Remove reader mode
      await webContents.executeJavaScript(`
        const overlay = document.getElementById('ab-reader-overlay');
        if (overlay) overlay.remove();
        document.body.style.overflow = '';
      `).catch(() => {})
      return false
    }

    // Inject reader mode
    await webContents.executeJavaScript(`
      (() => {
        // Extract article content
        const article = document.querySelector('article')
          || document.querySelector('main')
          || document.querySelector('[role="main"]')
          || document.querySelector('.post-content, .article-content, .entry-content, .content');

        let content = '';
        let title = document.title || '';

        if (article) {
          content = article.innerHTML;
          const h1 = article.querySelector('h1');
          if (h1) title = h1.innerText;
        } else {
          // Fallback: collect meaningful text blocks
          const blocks = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre');
          if (blocks.length > 3) {
            content = Array.from(blocks)
              .map(el => {
                const tag = el.tagName.toLowerCase();
                if (tag.startsWith('h')) return '<' + tag + '>' + el.innerText + '</' + tag + '>';
                if (tag === 'li') return '<li>' + el.innerText + '</li>';
                if (tag === 'blockquote') return '<blockquote>' + el.innerText + '</blockquote>';
                if (tag === 'pre') return '<pre>' + el.innerText + '</pre>';
                return '<p>' + el.innerText + '</p>';
              })
              .join('\\n');
          } else {
            content = document.body.innerText;
          }
        }

        // Create reader overlay
        const overlay = document.createElement('div');
        overlay.id = 'ab-reader-overlay';
        overlay.style.cssText = \`
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: #faf8f5; color: #1a1a1a; z-index: 2147483647;
          overflow-y: auto; padding: 0;
          font-family: Georgia, 'Times New Roman', serif;
        \`;

        // Header
        const header = document.createElement('div');
        header.style.cssText = \`
          position: sticky; top: 0; z-index: 10;
          background: #faf8f5; border-bottom: 1px solid #e5e5e5;
          padding: 12px 24px; display: flex; justify-content: space-between; align-items: center;
        \`;
        header.innerHTML = \`
          <span style="font-size: 14px; color: #666; font-family: -apple-system, sans-serif;">Reader Mode</span>
          <button id="ab-reader-close" style="
            background: none; border: 1px solid #ccc; border-radius: 6px;
            padding: 6px 12px; cursor: pointer; font-size: 13px; color: #666;
            font-family: -apple-system, sans-serif;
          ">Exit Reader</button>
        \`;

        // Content container
        const container = document.createElement('div');
        container.style.cssText = \`
          max-width: 680px; margin: 0 auto; padding: 40px 24px 80px;
        \`;

        // Title
        const titleEl = document.createElement('h1');
        titleEl.textContent = title;
        titleEl.style.cssText = \`
          font-size: 2.2em; line-height: 1.2; margin: 0 0 16px;
          font-weight: 700; color: #1a1a1a;
        \`;

        // URL
        const urlEl = document.createElement('div');
        urlEl.style.cssText = \`
          font-size: 13px; color: #888; margin-bottom 32px;
          font-family: -apple-system, sans-serif;
        \`;
        urlEl.textContent = location.hostname;

        // Content
        const contentEl = document.createElement('div');
        contentEl.style.cssText = \`
          font-size: 18px; line-height: 1.8; color: #333;
        \`;
        contentEl.innerHTML = content;

        // Style headings in content
        contentEl.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
          h.style.cssText = 'margin: 1.5em 0 0.5em; font-weight: 600; color: #1a1a1a;';
        });
        contentEl.querySelectorAll('p').forEach(p => {
          p.style.cssText = 'margin: 0 0 1.2em;';
        });
        contentEl.querySelectorAll('pre').forEach(pre => {
          pre.style.cssText = \`
            background: #f0f0f0; padding: 16px; border-radius: 6px;
            overflow-x: auto; font-size: 15px; line-height: 1.5;
          \`;
        });
        contentEl.querySelectorAll('blockquote').forEach(bq => {
          bq.style.cssText = \`
            border-left: 3px solid #ccc; margin: 1em 0; padding: 0.5em 0 0.5em 1em;
            color: #555; font-style: italic;
          \`;
        });

        container.appendChild(titleEl);
        container.appendChild(urlEl);
        container.appendChild(contentEl);
        overlay.appendChild(header);
        overlay.appendChild(container);
        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';

        // Close button
        document.getElementById('ab-reader-close')?.addEventListener('click', () => {
          overlay.remove();
          document.body.style.overflow = '';
        });
      })()
    `).catch(() => {})

    return true
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

  ipcMain.handle(IPC_CHANNELS.THEME_SET, (_event, theme: 'dark' | 'light' | 'system') => {
    Object.assign(settingsStore, updateSettings({ theme }))
    nativeTheme.themeSource = theme
    sendToRenderer(IPC_CHANNELS.THEME_SET, theme)
    return true
  })

  // ── Browsing data / downloads / passwords ───────────────────────────────

  ipcMain.handle(IPC_CHANNELS.SETTINGS_CHOOSE_DOWNLOAD_DIR, async () => {
    const win = getMainWindow()
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    Object.assign(settingsStore, updateSettings({ downloadPath: result.filePaths[0] }))
    return result.filePaths[0]
  })

  ipcMain.handle(IPC_CHANNELS.BROWSING_DATA_CLEAR, (_event, kinds: { cache: boolean; cookies: boolean }) => {
    return tabManager.clearBrowsingData(kinds)
  })

  // ── Subscription sign-in (OAuth) ─────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.OAUTH_START, async (_event, kind: OAuthKind) => {
    if (kind !== 'claude' && kind !== 'chatgpt' && kind !== 'gemini') throw new Error(`Unknown sign-in provider: ${kind}`)
    return oauthAccounts.signIn(kind, (url) => void shell.openExternal(url))
  })

  ipcMain.handle(IPC_CHANNELS.OAUTH_DISCONNECT, (_event, kind: OAuthKind) => {
    return oauthAccounts.disconnect(kind)
  })

  ipcMain.handle(IPC_CHANNELS.OAUTH_STATUS, () => {
    return oauthAccounts.statusAll()
  })

  ipcMain.handle(IPC_CHANNELS.PASSWORD_LIST, () => {
    return tabManager.getPasswordVault().list()
  })

  ipcMain.handle(IPC_CHANNELS.PASSWORD_DELETE, (_event, id: string) => {
    return tabManager.getPasswordVault().delete(id)
  })

  ipcMain.handle(IPC_CHANNELS.PASSWORD_CLEAR, () => {
    tabManager.getPasswordVault().clear()
    return true
  })

  ipcMain.handle(IPC_CHANNELS.PASSWORD_REVEAL, (_event, id: string) => {
    return tabManager.getPasswordVault().reveal(id)
  })
}
