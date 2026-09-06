import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, TabInfo, AppSettings, ChatMessage, AgentTask, AgentAction, PageContext, AIProvider, FindResult, HistoryEntry, Bookmark, Shortcut, Workflow, SavedPasswordMeta, DownloadItem } from '@shared/types'

const api = {
  tabs: {
    create: (url?: string, incognito?: boolean): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.TAB_CREATE, url, incognito),
    close: (tabId: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.TAB_CLOSE, tabId),
    switch: (tabId: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.TAB_SWITCH, tabId),
    navigate: (tabId: string, url: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.TAB_NAVIGATE, tabId, url),
    reload: (tabId: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.TAB_RELOAD, tabId),
    back: (tabId: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.TAB_BACK, tabId),
    forward: (tabId: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.TAB_FORWARD, tabId),
    stop: (tabId: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.TAB_STOP, tabId),
    list: (): Promise<TabInfo[]> => ipcRenderer.invoke(IPC_CHANNELS.TAB_LIST),
    moved: (fromIndex: number, toIndex: number): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.TAB_MOVED, fromIndex, toIndex),
    onUpdate: (callback: (tabs: TabInfo[], activeId: string | null) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, tabs: TabInfo[], activeId: string | null) => callback(tabs, activeId)
      ipcRenderer.on(IPC_CHANNELS.TAB_UPDATE, handler)
      return () => { ipcRenderer.removeListener(IPC_CHANNELS.TAB_UPDATE, handler) }
    }
  },

  agent: {
    start: (goal: string): Promise<AgentTask> => ipcRenderer.invoke(IPC_CHANNELS.AGENT_START, goal),
    stop: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.AGENT_STOP),
    pause: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.AGENT_PAUSE),
    resume: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.AGENT_RESUME),
    approve: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.AGENT_APPROVE),
    deny: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.AGENT_DENY),
    getStatus: (): Promise<{ isRunning: boolean; isPaused: boolean; task: AgentTask | null }> =>
      ipcRenderer.invoke(IPC_CHANNELS.AGENT_STATUS),
    onStatus: (callback: (task: AgentTask) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, task: AgentTask) => callback(task)
      ipcRenderer.on(IPC_CHANNELS.AGENT_STATUS, handler)
      return () => { ipcRenderer.removeListener(IPC_CHANNELS.AGENT_STATUS, handler) }
    },
    onActionLog: (callback: (action: AgentAction) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, action: AgentAction) => callback(action)
      ipcRenderer.on(IPC_CHANNELS.AGENT_ACTION_LOG, handler)
      return () => { ipcRenderer.removeListener(IPC_CHANNELS.AGENT_ACTION_LOG, handler) }
    },
    onRequestApproval: (callback: (description: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, description: string) => callback(description)
      ipcRenderer.on(IPC_CHANNELS.AGENT_REQUEST_APPROVAL, handler)
      return () => { ipcRenderer.removeListener(IPC_CHANNELS.AGENT_REQUEST_APPROVAL, handler) }
    },
    onDebugLog: (callback: (log: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, log: string) => callback(log)
      ipcRenderer.on(IPC_CHANNELS.AGENT_DEBUG_LOG, handler)
      return () => { ipcRenderer.removeListener(IPC_CHANNELS.AGENT_DEBUG_LOG, handler) }
    }
  },

  chat: {
    send: (messages: ChatMessage[]): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.CHAT_SEND, messages),
    summarize: (): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.CHAT_SUMMARIZE),
    explain: (): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.CHAT_EXPLAIN),
    vision: (question: string): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.CHAT_VISION, question),
    onStream: (callback: (token: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, token: string) => callback(token)
      ipcRenderer.on(IPC_CHANNELS.CHAT_STREAM, handler)
      return () => { ipcRenderer.removeListener(IPC_CHANNELS.CHAT_STREAM, handler) }
    },
    onResponse: (callback: (fullText: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, fullText: string) => callback(fullText)
      ipcRenderer.on(IPC_CHANNELS.CHAT_RESPONSE, handler)
      return () => { ipcRenderer.removeListener(IPC_CHANNELS.CHAT_RESPONSE, handler) }
    }
  },

  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
    set: (settings: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, settings),
    testKey: (): Promise<{ success: boolean; message: string; model?: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_TEST_KEY),
    getKeyStatus: (): Promise<Record<AIProvider, boolean>> =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_KEY_STATUS)
  },

  page: {
    getContext: (): Promise<PageContext | null> => ipcRenderer.invoke(IPC_CHANNELS.PAGE_CONTEXT),
    getScreenshot: (): Promise<string | null> => ipcRenderer.invoke(IPC_CHANNELS.PAGE_SCREENSHOT)
  },

  mcp: {
    getStatus: (enabled?: boolean, port?: number): Promise<{ running: boolean; port: number }> =>
      ipcRenderer.invoke(IPC_CHANNELS.MCP_STATUS, enabled, port)
  },

  commandPalette: {
    onToggle: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on(IPC_CHANNELS.COMMAND_PALETTE_TOGGLE, handler)
      return () => { ipcRenderer.removeListener(IPC_CHANNELS.COMMAND_PALETTE_TOGGLE, handler) }
    }
  },

  ui: {
    onShortcut: (callback: (combo: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, combo: string) => callback(combo)
      ipcRenderer.on(IPC_CHANNELS.UI_SHORTCUT, handler)
      return () => { ipcRenderer.removeListener(IPC_CHANNELS.UI_SHORTCUT, handler) }
    }
  },

  layout: {
    setInsets: (right: number): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.LAYOUT_INSETS, right),
    setOverlay: (active: boolean): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.LAYOUT_OVERLAY, active)
  },

  passwords: {
    list: (): Promise<SavedPasswordMeta[]> => ipcRenderer.invoke(IPC_CHANNELS.PASSWORD_LIST),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.PASSWORD_DELETE, id),
    clear: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.PASSWORD_CLEAR),
    reveal: (id: string): Promise<string | null> => ipcRenderer.invoke(IPC_CHANNELS.PASSWORD_REVEAL, id)
  },

  browsingData: {
    clear: (kinds: { cache: boolean; cookies: boolean }): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSING_DATA_CLEAR, kinds)
  },

  downloads: {
    chooseDir: (): Promise<string | null> => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_CHOOSE_DOWNLOAD_DIR),
    list: (): Promise<DownloadItem[]> => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_LIST),
    clear: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_CLEAR),
    onUpdate: (callback: (downloads: DownloadItem[]) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, downloads: DownloadItem[]) => callback(downloads)
      ipcRenderer.on(IPC_CHANNELS.DOWNLOAD_UPDATE, handler)
      return () => { ipcRenderer.removeListener(IPC_CHANNELS.DOWNLOAD_UPDATE, handler) }
    }
  },

  oauth: {
    signIn: (kind: 'claude' | 'chatgpt' | 'gemini'): Promise<{ connected: boolean; expiresAt?: number }> =>
      ipcRenderer.invoke(IPC_CHANNELS.OAUTH_START, kind),
    disconnect: (kind: 'claude' | 'chatgpt' | 'gemini'): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.OAUTH_DISCONNECT, kind),
    status: (): Promise<Record<string, { connected: boolean; expiresAt?: number }>> =>
      ipcRenderer.invoke(IPC_CHANNELS.OAUTH_STATUS)
  },

  reader: {
    toggle: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.READER_TOGGLE)
  },

  find: {
    start: (searchText: string, options?: { findNext?: boolean }): Promise<boolean | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.FIND_IN_PAGE, searchText, options),
    next: (searchText: string): Promise<boolean | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.FIND_NEXT, searchText),
    previous: (searchText: string): Promise<boolean | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.FIND_PREVIOUS, searchText),
    stop: (): Promise<boolean | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.FIND_STOP),
    onResult: (callback: (result: FindResult) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, result: FindResult) => callback(result)
      ipcRenderer.on(IPC_CHANNELS.FIND_RESULT, handler)
      return () => { ipcRenderer.removeListener(IPC_CHANNELS.FIND_RESULT, handler) }
    }
  },

  history: {
    add: (entry: HistoryEntry): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_ADD, entry),
    get: (): Promise<HistoryEntry[]> => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_GET),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_REMOVE, id),
    clear: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_CLEAR)
  },

  bookmarks: {
    add: (bookmark: Bookmark): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARK_ADD, bookmark),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARK_REMOVE, id),
    get: (): Promise<Bookmark[]> => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARK_GET),
    isBookmarked: (url: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARK_IS_BOOKMARKED, url)
  },

  tabPersistence: {
    save: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.TABS_SAVE),
    restore: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.TABS_RESTORE)
  },

  shortcuts: {
    get: (): Promise<Shortcut[]> => ipcRenderer.invoke(IPC_CHANNELS.SHORTCUTS_GET),
    set: (shortcuts: Shortcut[]): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.SHORTCUTS_SET, shortcuts)
  },

  workflows: {
    list: (): Promise<Workflow[]> => ipcRenderer.invoke(IPC_CHANNELS.WORKFLOW_LIST),
    save: (workflow: Workflow): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.WORKFLOW_SAVE, workflow),
    run: (workflowId: string): Promise<AgentTask> => ipcRenderer.invoke(IPC_CHANNELS.WORKFLOW_RUN, workflowId)
  },

  theme: {
    get: (): Promise<'dark' | 'light'> => ipcRenderer.invoke(IPC_CHANNELS.THEME_GET),
    set: (theme: 'dark' | 'light'): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.THEME_SET, theme),
    onChange: (callback: (theme: 'dark' | 'light') => void) => {
      const handler = (_event: Electron.IpcRendererEvent, theme: 'dark' | 'light') => callback(theme)
      ipcRenderer.on(IPC_CHANNELS.THEME_SET, handler)
      return () => { ipcRenderer.removeListener(IPC_CHANNELS.THEME_SET, handler) }
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
