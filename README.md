# AgenticBrowser

A privacy-first, open-source agentic browser with AI superpowers. Control the web with natural language, see pages live as the agent works, and keep everything on your machine.

**CLI-first.** Drive the browser entirely from your terminal — every command emits **pure JSON on stdout** (progress/errors go to stderr), so it pipes straight into `jq`, agents, or CI. The Electron GUI (see below) is optional; the CLI is fully standalone.

> Built with Electron + React + TypeScript. Powered by any AI provider you choose.

## 🎬 Watch the intro (36s)

https://github.com/tushar-alt/AgenticBrowser/releases/download/v1.0-intro/video.mp4

*Download: [video.mp4](https://github.com/tushar-alt/AgenticBrowser/releases/download/v1.0-intro/video.mp4) · also on the [releases page](https://github.com/tushar-alt/AgenticBrowser/releases/tag/v1.0-intro)*

## ⌨️ CLI Mode (BrowserOS-style, terminal-first)

```bash
npm install
npm run build:cli

# The first command spawns a detached headless Chrome that stays alive across commands
node dist/cli/index.js open https://news.ycombinator.com   # or: npx agentic open ...
node dist/cli/index.js info --out page.json                # full page snapshot as JSON
node dist/cli/index.js click e12                           # click by element ref from the JSON
node dist/cli/index.js run "find the top 5 stories and list their titles" --steps 10
node dist/cli/index.js ask "summarize the top story"
node dist/cli/index.js close-browser
```

Install it globally if you like: `npm link` → then the command is `agentic` anywhere.

### Commands

| Command | What it does |
|---------|--------------|
| `open <url>` | Navigate the active tab; prints full page JSON |
| `newtab <url>` | Open a URL in a new tab and switch to it |
| `info [--selector CSS] [--text-limit N]` | AI-ready structured page snapshot (see schema below) |
| `text [--selector CSS]` | Page text only |
| `links` / `forms` / `tables` / `images` | Single slices of the page JSON |
| `click <ref\|css>` | Click by element ref (`e12`) or CSS selector |
| `type <ref\|css> "<value>"` | Clear + type into an input, fires input/change events |
| `scroll <up\|down> [px]` | Scroll the page |
| `screenshot [--file FILE]` | PNG capture |
| `tabs` / `tab <n>` / `back` / `close [n]` | Tab management |
| `close-browser` | Quit the background browser |
| `ask "<question>"` | One-shot LLM Q&A over the current page JSON |
| `run "<task>" [--steps N]` | Multi-step natural-language agent loop |

### AI-ready page JSON

`open` and `info` emit a single structured object — refs are stable element
handles the AI can act on (`agentic click e12`):

```json
{
  "url": "https://example.com/",
  "title": "Example Domain",
  "meta": { "description": "...", "og:title": "..." },
  "headings": [{ "level": 1, "text": "Example Domain" }],
  "links": [{ "ref": "e0", "text": "Learn more", "href": "https://iana.org/..." }],
  "forms": [{ "ref": "e7", "action": "...", "method": "get", "fields": [...] }],
  "tables": [{ "headers": ["..."], "rows": [["..."]] }],
  "interactive": [{ "ref": "e8", "tag": "button", "type": "", "text": "Sign up" }],
  "text": "Readable article text (truncated, article/main-aware)...",
  "wordCount": 19,
  "extractedAt": "2026-09-04T18:39:46.456Z"
}
```

### Agent configuration (BYOK, zero-telemetry)

The agent resolves an AI provider in this order — everything stays on your machine:

1. `AGENTIC_API_KEY` + `AGENTIC_BASE_URL` (+ optional `AGENTIC_MODEL`, `AGENTIC_STYLE=anthropic|openai`) — any Anthropic- or OpenAI-compatible endpoint
2. `AGENTIC_PROVIDER=openai|anthropic` with `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`
3. **Zero-config**: an enabled provider from your local ZCode config (`~/.zcode/v2/config.json`) is used automatically when present — providers are tried in order and fallback is automatic
4. Local Ollama (`OLLAMA_HOST`, default `localhost:11434`)

`AGENTIC_VERBOSE=1` prints each agent step's thought and action to stderr.
No keys are ever written to disk by the CLI.

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
| `Ctrl+K` | Command palette (commands, tabs, history, bookmarks, `>` agent tasks) |
| `Ctrl+L` | Focus address bar |
| `Ctrl+B` | Toggle AI chat panel |
| `Ctrl+Shift+A` | Toggle agent supervisor |
| `Ctrl+F` | Find in page |
| `Ctrl+H` | Toggle browsing history |
| `Enter` | Navigate to URL or search |
| `> text` | Run agent task (in command palette or new tab) |

Shortcuts work everywhere — on web pages too (they are captured in the main process and forwarded to the UI).

## 🏗️ Architecture

```
CLI (src/cli — zero extra dependencies, Node >= 22)
├── index.ts            — command router (open/info/click/type/ask/run/...)
├── cdp.ts              — CDP WebSocket client + detached headless Chrome launcher
│                         (persistent session in ~/.agentic-browser/session.json)
├── pageJson.ts         — AI-ready page → JSON extractor with element refs
└── agent.ts            — LLM action loop (Anthropic/OpenAI/custom/Ollama/ZCode)

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
