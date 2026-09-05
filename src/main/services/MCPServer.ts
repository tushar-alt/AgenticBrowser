import { EventEmitter } from 'events'
import { CDPController } from './CDPController'
import { ContentExtractor } from './ContentExtractor'
import { TabManager } from '../tabManager'
import { MCPTool, MCPToolResult } from '@shared/types'
import * as http from 'http'
import crypto from 'crypto'

export class MCPServer extends EventEmitter {
  private server: http.Server | null = null
  private cdpController: CDPController
  private contentExtractor: ContentExtractor
  private tabManager: TabManager
  private port: number
  private isRunning: boolean = false
  private token: string = crypto.randomBytes(24).toString('hex')

  constructor(
    cdpController: CDPController,
    contentExtractor: ContentExtractor,
    tabManager: TabManager,
    port: number = 3900
  ) {
    super()
    this.cdpController = cdpController
    this.contentExtractor = contentExtractor
    this.tabManager = tabManager
    this.port = port
  }

  getTools(): MCPTool[] {
    return [
      {
        name: 'browser_navigate',
        description: 'Navigate the active browser tab to a URL',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'The URL to navigate to' }
          },
          required: ['url']
        }
      },
      {
        name: 'browser_click',
        description: 'Click an element on the page by CSS selector',
        inputSchema: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS selector of the element to click' }
          },
          required: ['selector']
        }
      },
      {
        name: 'browser_type',
        description: 'Type text into an input element',
        inputSchema: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS selector of the input' },
            value: { type: 'string', description: 'Text to type' }
          },
          required: ['selector', 'value']
        }
      },
      {
        name: 'browser_screenshot',
        description: 'Capture a screenshot of the current page',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'browser_get_text',
        description: 'Get the text content of the page or a specific element',
        inputSchema: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'Optional CSS selector' }
          }
        }
      },
      {
        name: 'browser_execute_js',
        description: 'Execute JavaScript in the page context',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'JavaScript code to execute' }
          },
          required: ['code']
        }
      },
      {
        name: 'browser_scroll',
        description: 'Scroll the page up or down',
        inputSchema: {
          type: 'object',
          properties: {
            direction: { type: 'string', enum: ['up', 'down'] },
            amount: { type: 'number', description: 'Pixels to scroll' }
          }
        }
      },
      {
        name: 'browser_get_page_info',
        description: 'Get the current URL and page title',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'browser_get_dom',
        description: 'Get a simplified DOM tree of the page',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'browser_get_links',
        description: 'Extract all links from the page',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'browser_get_interactive_elements',
        description: 'Find all clickable/interactive elements on the page',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'browser_get_context',
        description: 'Get full page context including text, metadata, and selected text',
        inputSchema: { type: 'object', properties: {} }
      }
    ]
  }

  async start(): Promise<void> {
    if (this.isRunning) return

    this.server = http.createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json')

      // Local-only hardening: no CORS (local MCP clients don't need it), and
      // reject requests whose Host isn't this loopback endpoint (DNS rebinding
      // defense) or that carry a cross-site browser Origin.
      const host = String(req.headers.host || '')
      if (!host.startsWith('127.0.0.1:') && !host.startsWith('localhost:')) {
        res.writeHead(403)
        res.end(JSON.stringify({ error: 'Forbidden host' }))
        return
      }
      if (req.headers.origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(String(req.headers.origin))) {
        res.writeHead(403)
        res.end(JSON.stringify({ error: 'Forbidden origin' }))
        return
      }

      if (req.method === 'OPTIONS') {
        res.writeHead(405)
        res.end()
        return
      }

      if (req.method !== 'POST') {
        res.writeHead(405)
        res.end(JSON.stringify({ error: 'Method not allowed' }))
        return
      }

      const auth = String(req.headers.authorization || '')
      if (auth !== 'Bearer ' + this.token) {
        res.writeHead(401)
        res.end(JSON.stringify({ error: 'Unauthorized - set Authorization: Bearer <token> from Settings' }))
        return
      }

      let body = ''
      req.on('data', (chunk: Buffer) => { body += chunk.toString() })
      req.on('end', async () => {
        try {
          const request = JSON.parse(body)
          const result = await this.handleRequest(request)
          res.writeHead(200)
          res.end(JSON.stringify(result))
        } catch (error: unknown) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
        }
      })
    })

    return new Promise((resolve, reject) => {
      this.server!.listen(this.port, '127.0.0.1', () => {
        this.isRunning = true
        this.emit('started', { port: this.port })
        resolve()
      })
      this.server!.on('error', reject)
    })
  }

  async stop(): Promise<void> {
    if (!this.server) return
    return new Promise((resolve) => {
      this.server!.close(() => {
        this.isRunning = false
        this.server = null
        this.emit('stopped')
        resolve()
      })
    })
  }

  private async handleRequest(request: { method: string; params?: Record<string, unknown> }): Promise<unknown> {
    if (request.method === 'initialize') {
      return {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'agentic-browser-mcp', version: '1.0.0' }
      }
    }

    if (request.method === 'tools/list') {
      return { tools: this.getTools() }
    }

    if (request.method === 'tools/call') {
      const { name, arguments: args } = request.params as { name: string; arguments: Record<string, unknown> }
      return this.handleToolCall(name, args || {})
    }

    throw new Error(`Unknown method: ${request.method}`)
  }

  private async handleToolCall(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    const activeTab = this.tabManager.getActiveTab()
    if (!activeTab && !['browser_navigate'].includes(name)) {
      return { content: [{ type: 'text', text: 'No active tab available' }], isError: true }
    }

    const tabId = activeTab!.id
    const webContents = activeTab!.view.webContents

    try {
      let result: string

      switch (name) {
        case 'browser_navigate': {
          const newTab = this.tabManager.getActiveTab()!
          this.tabManager.navigateTab(newTab.id, args.url as string)
          result = `Navigated to ${args.url}`
          break
        }
        case 'browser_click':
          if (!this.cdpController.isAttached(tabId)) this.cdpController.attach(tabId, webContents)
          await this.cdpController.click(tabId, args.selector as string)
          result = `Clicked ${args.selector}`
          break
        case 'browser_type':
          if (!this.cdpController.isAttached(tabId)) this.cdpController.attach(tabId, webContents)
          await this.cdpController.type(tabId, args.selector as string, args.value as string)
          result = `Typed into ${args.selector}`
          break
        case 'browser_screenshot':
          if (!this.cdpController.isAttached(tabId)) this.cdpController.attach(tabId, webContents)
          result = await this.cdpController.screenshot(tabId)
          break
        case 'browser_get_text':
          if (!this.cdpController.isAttached(tabId)) this.cdpController.attach(tabId, webContents)
          result = await this.cdpController.getText(tabId, args.selector as string | undefined)
          break
        case 'browser_execute_js':
          if (!this.cdpController.isAttached(tabId)) this.cdpController.attach(tabId, webContents)
          result = String(await this.cdpController.executeJS(tabId, args.code as string))
          break
        case 'browser_scroll':
          if (!this.cdpController.isAttached(tabId)) this.cdpController.attach(tabId, webContents)
          await this.cdpController.scroll(tabId, (args.direction as 'up' | 'down') || 'down', (args.amount as number) || 300)
          result = `Scrolled ${args.direction || 'down'}`
          break
        case 'browser_get_page_info':
          if (!this.cdpController.isAttached(tabId)) this.cdpController.attach(tabId, webContents)
          result = JSON.stringify(await this.cdpController.getPageInfo(tabId))
          break
        case 'browser_get_dom':
          if (!this.cdpController.isAttached(tabId)) this.cdpController.attach(tabId, webContents)
          result = await this.cdpController.getDOMSnapshot(tabId)
          break
        case 'browser_get_links': {
          const links = await this.contentExtractor.extractLinks(webContents)
          result = JSON.stringify(links, null, 2)
          break
        }
        case 'browser_get_interactive_elements':
          if (!this.cdpController.isAttached(tabId)) this.cdpController.attach(tabId, webContents)
          result = JSON.stringify(await this.cdpController.findInteractiveElements(tabId), null, 2)
          break
        case 'browser_get_context': {
          const ctx = await this.contentExtractor.extractPageContext(webContents)
          result = JSON.stringify(ctx, null, 2)
          break
        }
        default:
          return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
      }

      return { content: [{ type: 'text', text: result }] }
    } catch (error: unknown) {
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true
      }
    }
  }

  getStatus(): { running: boolean; port: number; token?: string } {
    return {
      running: this.isRunning,
      port: this.port,
      token: this.isRunning ? this.token : undefined
    }
  }
}
