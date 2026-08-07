export type AIProvider = 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'custom'

export interface AIKeyConfig {
  provider: AIProvider
  encryptedKey: string
  baseURL?: string
  model?: string
}

export interface AIProviderConfig {
  provider: AIProvider
  apiKey: string
  baseURL?: string
  model?: string
}

export interface TabInfo {
  id: string
  title: string
  url: string
  favicon: string
  isActive: boolean
  isLoading: boolean
  isNewTab: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export type AgentStatus = 'idle' | 'planning' | 'running' | 'paused' | 'completed' | 'failed' | 'stopped'

export interface AgentAction {
  id: string
  type: 'navigate' | 'click' | 'type' | 'scroll' | 'screenshot' | 'extract' | 'wait' | 'js_execute'
  description: string
  selector?: string
  value?: string
  url?: string
  code?: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'awaiting_approval'
  result?: string
  timestamp: number
  requiresApproval?: boolean
}

export interface AgentTask {
  id: string
  goal: string
  status: AgentStatus
  plan: string[]
  currentStep: number
  actions: AgentAction[]
  startTime: number
  endTime?: number
  error?: string
  checkpointData?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  isStreaming?: boolean
}

export interface VisionImage {
  data: string
  mimeType: string
}

export interface VisionChatMessage extends ChatMessage {
  images?: VisionImage[]
}

export interface PageContext {
  url: string
  title: string
  textContent: string
  htmlContent: string
  selectedText?: string
  screenshot?: string
}

export interface AppSettings {
  aiProvider: AIProvider
  apiKey: string
  baseURL: string
  model: string
  approvalMode: 'always' | 'sensitive' | 'never'
  maxAgentSteps: number
  agentTimeout: number
  theme: 'dark' | 'light'
  showChatPanel: boolean
  showSupervisor: boolean
  mcpServerEnabled: boolean
  mcpServerPort: number
}

export interface AgentPlan {
  goal: string
  steps: string[]
  estimatedActions: number
  requiresLogin: boolean
  sensitiveActions: string[]
}

export interface CDPAction {
  type: AgentAction['type']
  selector?: string
  value?: string
  url?: string
  code?: string
  options?: Record<string, unknown>
}

export interface MCPTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface MCPToolResult {
  content: Array<{ type: string; text: string }>
  isError?: boolean
}

export const IPC_CHANNELS = {
  TAB_CREATE: 'tab:create',
  TAB_CLOSE: 'tab:close',
  TAB_SWITCH: 'tab:switch',
  TAB_UPDATE: 'tab:update',
  TAB_NAVIGATE: 'tab:navigate',
  TAB_RELOAD: 'tab:reload',
  TAB_BACK: 'tab:back',
  TAB_FORWARD: 'tab:forward',
  TAB_STOP: 'tab:stop',
  TAB_LIST: 'tab:list',
  TAB_MOVED: 'tab:moved',

  AGENT_START: 'agent:start',
  AGENT_STOP: 'agent:stop',
  AGENT_PAUSE: 'agent:pause',
  AGENT_RESUME: 'agent:resume',
  AGENT_APPROVE: 'agent:approve',
  AGENT_DENY: 'agent:deny',
  AGENT_STATUS: 'agent:status',
  AGENT_ACTION_LOG: 'agent:action-log',
  AGENT_CHECKPOINT: 'agent:checkpoint',
  AGENT_ROLLBACK: 'agent:rollback',

  CHAT_SEND: 'chat:send',
  CHAT_RESPONSE: 'chat:response',
  CHAT_STREAM: 'chat:stream',
  CHAT_SUMMARIZE: 'chat:summarize',
  CHAT_EXPLAIN: 'chat:explain',

  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_TEST_KEY: 'settings:test-key',
  SETTINGS_GET_KEY_STATUS: 'settings:key-status',

  PAGE_CONTEXT: 'page:context',
  PAGE_EXTRACT: 'page:extract',
  PAGE_HIGHLIGHT: 'page:highlight',
  PAGE_SCREENSHOT: 'page:screenshot',

  MCP_STATUS: 'mcp:status',

  WINDOW_FOCUS: 'window:focus',
  COMMAND_PALETTE_TOGGLE: 'command-palette:toggle',
  LAYOUT_INSETS: 'layout:insets',

  NAV_URL_CHANGED: 'nav:url-changed',
  NAV_TITLE_CHANGED: 'nav:title-changed',
  NAV_LOADING: 'nav:loading',
  NAV_FAVICON: 'nav:favicon',

  AGENT_REQUEST_APPROVAL: 'agent:request-approval',

  // History & Bookmarks
  HISTORY_ADD: 'history:add',
  HISTORY_GET: 'history:get',
  HISTORY_CLEAR: 'history:clear',
  HISTORY_REMOVE: 'history:remove',
  BOOKMARK_ADD: 'bookmark:add',
  BOOKMARK_REMOVE: 'bookmark:remove',
  BOOKMARK_GET: 'bookmark:get',
  BOOKMARK_IS_BOOKMARKED: 'bookmark:is-bookmarked',

  // Find in Page
  FIND_IN_PAGE: 'find:in-page',
  FIND_NEXT: 'find:next',
  FIND_PREVIOUS: 'find:previous',
  FIND_STOP: 'find:stop',
  FIND_RESULT: 'find:result',

  // Vision AI
  CHAT_VISION: 'chat:vision',

  // Debug
  AGENT_DEBUG_LOG: 'agent:debug-log',

  // Tab Persistence
  TABS_SAVE: 'tabs:save',
  TABS_RESTORE: 'tabs:restore',

  // Workflow
  WORKFLOW_SAVE: 'workflow:save',
  WORKFLOW_LIST: 'workflow:list',
  WORKFLOW_RUN: 'workflow:run',

  // Custom Shortcuts
  SHORTCUTS_GET: 'shortcuts:get',
  SHORTCUTS_SET: 'shortcuts:set',

  // Theme
  THEME_GET: 'theme:get',
  THEME_SET: 'theme:set'
} as const

export const DEFAULT_HOMEPAGE = 'about:blank'
export const NEW_TAB_URL = 'about:blank'
export const MAX_TABS = 50
export const DEFAULT_AGENT_TIMEOUT = 120_000
export const DEFAULT_MAX_AGENT_STEPS = 50

export interface HistoryEntry {
  id: string
  url: string
  title: string
  favicon: string
  timestamp: number
}

export interface Bookmark {
  id: string
  url: string
  title: string
  favicon: string
  timestamp: number
  folder?: string
}

export interface Shortcut {
  id: string
  label: string
  url: string
  tint: string
}

export interface WorkflowStep {
  type: AgentAction['type']
  selector?: string
  value?: string
  url?: string
  code?: string
  description: string
}

export interface Workflow {
  id: string
  name: string
  steps: WorkflowStep[]
  createdAt: number
}

export interface FindResult {
  requestId: number
  activeMatchOrdinal: number
  matches: number
  selectionArea: { x: number; y: number; width: number; height: number }
  finalUpdate: boolean
}
