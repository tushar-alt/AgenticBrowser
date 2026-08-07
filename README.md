# AgenticBrowser

A privacy-first, open-source agentic browser with AI superpowers. Control the web with natural language, see pages live as the agent works, and keep everything on your machine.

> Built with Electron + React + TypeScript. Powered by any AI provider you choose.

## ✨ Features

### 🤖 AI Agent Engine
- **Natural language → browser automation** — Describe a task, the agent plans and executes it step by step
- **Vision AI** — Agent captures screenshots and sends to multimodal models (GPT-4o, Claude, Gemini) for visual understanding
- **Live page display** — Watch the browser navigate and interact with pages in real-time as the agent works
- **Smart selectors** — Priority-based element selection: data-testid > aria-label > name > placeholder > CSS class
- **Structured page understanding** — Extracts headings, forms, landmarks, and interactive elements for better decisions
- **Approval modes** — Always ask, sensitive-only, or fully autonomous

### 💬 AI Chat
- **Page-aware chat** — Sidebar chat that knows what page you're on
- **Summarize** — One-click page summarization
- **Explain** — Select text and get instant explanations
- **Screenshot & Ask** — Capture the page and ask visual questions
- **Streaming responses** — Token-by-token streaming for all providers

### 🌐 Full Browser
- **Multi-tab browsing** — Real Chromium tabs via WebContentsView (not iframes)
- **Session isolation** — Each tab gets its own partition
- **Navigation** — Back, forward, reload, URL bar with search detection
- **Drag & drop** tabs to reorder
- **Tab persistence** — Tabs restore across app restarts

### 📚 History & Bookmarks
- **Browsing history** — Auto-tracked, grouped by date (Today/Yesterday/Older), searchable
- **Bookmarks** — Star button in address bar, folder support, persistent storage
- **Command palette search** — Find history/bookmarks instantly via Ctrl+L

### 🔍 Find in Page
- **Ctrl+F** — Native find-in-page with match counting ("3 of 15")
- **Navigation** — Next/Previous with Enter/Shift+Enter
- **Highlight all** matches on the page

### 🎯 Command Palette
- **Ctrl+L** — Quick access to all commands
- **`>` prefix** — Start agent tasks directly from the palette
- **Tab switching** — Jump to any open tab
- **Fuzzy search** across commands, tabs, history, and bookmarks

### 🔧 MCP Server
- **External agent control** — Expose browser to Claude Code, Cursor, Qwen Code, etc.
- **12 browser tools** — navigate, click, type, screenshot, extract, scroll, execute JS, and more
- **MCP Protocol 2024-11-05** compatible

### 🔒 Security & Privacy
- **BYOK (Bring Your Own Key)** — OpenAI, Anthropic, Gemini, Ollama, or any OpenAI-compatible endpoint
- **OS keychain encryption** — API keys encrypted via Electron safeStorage (Windows DPAPI, macOS Keychain, Linux libsecret)
- **No telemetry** — No analytics, no cloud sync, no data leaves your machine
- **CSP configured** — Content Security Policy restricts script/connect sources
- **Context isolation** — All web views are sandboxed

### 🎨 UI Polish
- **Dark theme** — Near-black (#0e0e10) with orange accent (#f26522)
- **Customizable shortcuts** — Add/remove/edit quick links on new tab page
- **Agent banner** — Live status banner injected into controlled pages
- **Element highlighting** — Animated orange glow on agent-targeted elements
- **Error boundary** — Graceful crash recovery without losing state

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Start in development mode
npm run dev

# Build for production
npm run build

# Package for your platform
npm run build:win     # Windows (NSIS installer)
npm run build:mac     # macOS (DMG)
npm run build:linux   # Linux (AppImage + deb)
```

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+T` | New tab |
| `Ctrl+W` | Close tab |
| `Ctrl+L` | Focus address bar / Command palette |
| `Ctrl+B` | Toggle AI chat panel |
| `Ctrl+Shift+A` | Toggle agent supervisor |
| `Ctrl+F` | Find in page |
| `Ctrl+H` | Toggle browsing history |
| `Enter` | Navigate to URL or search |
| `> text` | Run agent task (in command palette or new tab) |

## 🏗️ Architecture

```
Main Process (Node.js)
├── WindowManager       — BaseWindow + renderer WebContentsView
├── TabManager          — WebContentsView per tab, visibility management
├── SecureStorage       — OS keychain encryption via safeStorage
├── AIClient            — Multi-provider streaming (OpenAI, Anthropic, Gemini, Ollama)
├── CDPController       — Chrome DevTools Protocol automation
├── AgentOrchestrator   — Planner → Executor agent loop with vision support
├── ContentExtractor    — DOM extraction, readability, structured page info
└── MCPServer           — MCP protocol HTTP server (optional)

Renderer Process (React 19)
├── TabBar              — Draggable tab strip
├── AddressBar          — Navigation + bookmark star + assistant toggle
├── ChatPanel           — AI chat with streaming + vision
├── Supervisor          — Agent monitoring + approval UI
├── CommandPalette      — Quick commands with fuzzy search
├── NewTab              — Dashboard with customizable shortcuts
├── FindInPage          — Ctrl+F search overlay
├── HistoryPanel        — Browsing history browser
├── BookmarksPanel      — Bookmarks manager
├── Settings            — Provider configuration (BYOK)
└── ErrorBoundary       — Graceful crash recovery

State Management (Zustand)
├── tabStore            — Tab state + IPC actions
├── agentStore          — Agent task/actions/approval
├── settingsStore       — Settings, key status, test results
└── historyStore        — History + bookmarks (persisted via electron-store)
```

## 🔑 API Key Setup

1. Open **Settings** (⚙️ button or via Command Palette)
2. Select your AI provider (OpenAI, Anthropic, Gemini, Ollama, or Custom)
3. Enter your API key (encrypted with OS keychain on save)
4. Click **Test Connection** to verify
5. Start using AI chat (`Ctrl+B`) or agent (`> your task`)

## 🤖 Agent Commands

Type `>` followed by a natural language task anywhere:

- `> go to github.com and find trending repos`
- `> search for flights to Lisbon on Google`
- `> fill out the contact form with my info`
- `> summarize the top 5 articles on Hacker News`
- `> take a screenshot of this page`

The agent will:
1. **Plan** — Break your goal into concrete steps
2. **Execute** — Navigate, click, type, and extract using CDP
3. **Show live** — You see the browser working in real-time
4. **Report** — Summary of what was accomplished

## 📡 MCP Server (External Agent Control)

Enable in Settings → MCP Server to expose browser control to external agents:

```json
{
  "tools": [
    "browser_navigate",
    "browser_click",
    "browser_type",
    "browser_screenshot",
    "browser_get_text",
    "browser_execute_js",
    "browser_scroll",
    "browser_get_page_info",
    "browser_get_dom",
    "browser_get_links",
    "browser_get_interactive_elements",
    "browser_get_context"
  ]
}
```

Connect from Claude Code, Cursor, or any MCP-compatible agent on `http://localhost:3900`.

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop runtime | Electron 33 |
| Build system | electron-vite + Vite 6 |
| Frontend | React 19 + TypeScript 5.7 |
| State management | Zustand 5 |
| Styling | Tailwind CSS 3.4 |
| Icons | Lucide React |
| AI SDKs | OpenAI, Anthropic, Gemini (REST), Ollama (REST) |
| Browser automation | Chrome DevTools Protocol (CDP) |
| Persistence | electron-store |
| Keychain | Electron safeStorage |

## 📄 License

MIT
