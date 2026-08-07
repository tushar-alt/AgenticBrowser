import { EventEmitter } from 'events'
import { AIClient } from './AIClient'
import { CDPController } from './CDPController'
import { ContentExtractor } from './ContentExtractor'
import { TabManager } from '../tabManager'
import { AgentTask, AgentAction, AgentPlan, CDPAction, ChatMessage } from '@shared/types'
import crypto from 'crypto'

const PLANNER_SYSTEM_PROMPT = `You are an AI agent that breaks down web browsing goals into concrete, executable steps.
Given a user's goal and the current page context, produce a JSON plan with this exact structure:
{
  "goal": "the user's goal",
  "steps": ["step 1 description", "step 2 description", ...],
  "estimatedActions": <number>,
  "requiresLogin": <boolean>,
  "sensitiveActions": ["description of any sensitive actions like form submissions, purchases, deletions"]
}
Be specific. Each step should be a single browser action (navigate, click, type, extract, scroll, wait).
Max 20 steps. Prefer fewer, more meaningful steps.`

const EXECUTOR_SYSTEM_PROMPT = `You are an AI browser automation agent. You execute web tasks step by step.
Given the current step, page DOM structure, and available interactive elements, produce a JSON action:
{
  "type": "navigate|click|type|scroll|screenshot|extract|wait|js_execute",
  "selector": "CSS selector (for click/type/extract)",
  "value": "text to type (for type action)",
  "url": "URL (for navigate)",
  "code": "JavaScript code (for js_execute)",
  "options": {},
  "description": "human-readable description of what this action does"
}

IMPORTANT SELECTOR RULES:
- Use the MOST SPECIFIC selector from the interactive elements list
- Prefer: data-testid > #id > [aria-label] > [name] > [placeholder] > tag.class
- For text inputs: use [name] or [placeholder] selectors
- For buttons: use the text content match or [aria-label]
- For links: use the href or text content
- Always verify the selector exists in the interactive elements list before using it

If the step is complete, return: { "type": "extract", "description": "Step completed: ..." }`

const VISION_EXECUTOR_SYSTEM_PROMPT = `You are an AI browser automation agent with vision capabilities. You execute web tasks step by step.
You can see the current page screenshot. Use visual information to make better decisions about where to click, type, and navigate.
Given the current step, page DOM structure, available interactive elements, AND the page screenshot, produce a JSON action:
{
  "type": "navigate|click|type|scroll|screenshot|extract|wait|js_execute",
  "selector": "CSS selector (for click/type/extract)",
  "value": "text to type (for type action)",
  "url": "URL (for navigate)",
  "code": "JavaScript code (for js_execute)",
  "options": {},
  "description": "human-readable description of what this action does"
}
Use the screenshot to identify visual layout, button positions, form fields, and page state that may not be obvious from DOM alone.
Choose the most specific CSS selector. Prefer IDs and data attributes.
If the step is complete, return: { "type": "extract", "description": "Step completed: ..." }`

export class AgentOrchestrator extends EventEmitter {
  private task: AgentTask | null = null
  private aiClient: AIClient
  private cdpController: CDPController
  private contentExtractor: ContentExtractor
  private tabManager: TabManager
  private isPaused: boolean = false
  private isStopped: boolean = false
  private approvalResolver: ((approved: boolean) => void) | null = null
  private approvalMode: 'always' | 'sensitive' | 'never' = 'sensitive'

  constructor(
    aiClient: AIClient,
    cdpController: CDPController,
    contentExtractor: ContentExtractor,
    tabManager: TabManager
  ) {
    super()
    this.aiClient = aiClient
    this.cdpController = cdpController
    this.contentExtractor = contentExtractor
    this.tabManager = tabManager
  }

  setApprovalMode(mode: 'always' | 'sensitive' | 'never'): void {
    this.approvalMode = mode
  }

  async startTask(goal: string): Promise<AgentTask> {
    if (this.task && this.task.status === 'running') {
      throw new Error('An agent task is already running')
    }

    const task: AgentTask = {
      id: crypto.randomUUID(),
      goal,
      status: 'planning',
      plan: [],
      currentStep: 0,
      actions: [],
      startTime: Date.now()
    }

    this.task = task
    this.isPaused = false
    this.isStopped = false

    this.emit('status', task)

    try {
      const plan = await this.planTask(goal)
      task.plan = plan.steps
      task.status = 'running'
      this.emit('status', task)

      await this.executePlan(task, plan)
    } catch (error: unknown) {
      await this.clearBanner()
      task.status = 'failed'
      task.error = error instanceof Error ? error.message : String(error)
      task.endTime = Date.now()
      this.emit('status', task)
    }

    return task
  }

  private async planTask(goal: string): Promise<AgentPlan> {
    const activeTab = this.tabManager.getActiveTab()
    let pageContext = ''
    if (activeTab) {
      const wc = activeTab.view.webContents
      const ctx = await this.contentExtractor.extractPageContext(wc)
      pageContext = `Current page: ${ctx.title} (${ctx.url})\nPage content preview: ${ctx.textContent.substring(0, 2000)}`
    }

    const messages: ChatMessage[] = [
      {
        id: 'plan',
        role: 'user',
        content: `Goal: ${goal}\n\n${pageContext}\n\nBreak this into concrete browser automation steps.`,
        timestamp: Date.now()
      }
    ]

    await this.setBanner('planning your task…')

    const response = await this.aiClient.sendMessage(messages, PLANNER_SYSTEM_PROMPT)

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON found in planner response')
      return JSON.parse(jsonMatch[0]) as AgentPlan
    } catch {
      return {
        goal,
        steps: [goal],
        estimatedActions: 1,
        requiresLogin: false,
        sensitiveActions: []
      }
    }
  }

  private async executePlan(task: AgentTask, plan: AgentPlan): Promise<void> {
    for (let i = 0; i < task.plan.length; i++) {
      if (this.isStopped) break

      while (this.isPaused) {
        await new Promise((r) => setTimeout(r, 200))
        if (this.isStopped) break
      }

      if (this.isStopped) break

      task.currentStep = i
      this.emit('status', task)

      const stepDescription = task.plan[i]
      const maxRetries = 3

      for (let retry = 0; retry < maxRetries; retry++) {
        try {
          await this.executeStep(task, stepDescription, plan)
          break
        } catch (error: unknown) {
          if (retry === maxRetries - 1) {
            this.addAction(task, {
              type: 'wait',
              description: `Step failed after ${maxRetries} attempts: ${error instanceof Error ? error.message : String(error)}`,
              status: 'failed'
            })
          } else {
            await new Promise((r) => setTimeout(r, 1000))
          }
        }
      }
    }

    await this.clearBanner()

    task.status = this.isStopped ? 'stopped' : 'completed'
    task.endTime = Date.now()
    this.emit('status', task)
  }

  private async executeStep(task: AgentTask, stepDescription: string, plan: AgentPlan): Promise<void> {
    const activeTab = this.tabManager.getActiveTab()
    if (!activeTab) throw new Error('No active tab')

    const tabId = activeTab.id
    const webContents = activeTab.view.webContents

    if (!this.cdpController.isAttached(tabId)) {
      this.cdpController.attach(tabId, webContents)
    }

    const domSnapshot = await this.cdpController.getDOMSnapshot(tabId)
    const interactiveElements = await this.cdpController.findInteractiveElements(tabId)
    const pageInfo = await this.cdpController.getPageInfo(tabId)

    // Get structured page info for better understanding
    let structuredInfo = ''
    try {
      const info = await this.contentExtractor.extractStructuredPageInfo(webContents)
      if (info.headings.length > 0) {
        structuredInfo += `\nPage headings: ${info.headings.join(' | ')}`
      }
      if (info.forms.length > 0) {
        structuredInfo += `\nForms: ${info.forms.map(f => `[${f.fields.join(', ')}]`).join(', ')}`
      }
      if (info.landmarks.length > 0) {
        structuredInfo += `\nLandmarks: ${info.landmarks.join(', ')}`
      }
    } catch {
      // Structured extraction failed, continue without it
    }

    // Capture screenshot for vision-aware execution
    let screenshotData: string | null = null
    try {
      screenshotData = await this.cdpController.screenshot(tabId)
    } catch {
      // Screenshot may fail on certain pages; continue without it
    }

    const messages: ChatMessage[] = [
      {
        id: 'exec',
        role: 'user',
        content: `Current step: "${stepDescription}"
Current URL: ${pageInfo.url}
Current page title: ${pageInfo.title}
${structuredInfo}

Interactive elements on page:
${interactiveElements.map((el, i) => `${i + 1}. <${el.tag}> ${el.text || el.type} [${el.selector}]`).join('\n')}

DOM structure (condensed):
${domSnapshot.substring(0, 4000)}

Execute this step. Return ONLY a JSON action object.`,
        timestamp: Date.now()
      }
    ]

    await this.setBanner('deciding next move…')

    // Add timeout to prevent hanging forever on slow AI responses
    const AI_TIMEOUT_MS = 60000 // 60 seconds
    const aiCall = screenshotData
      ? this.aiClient.sendVisionMessage(messages, [{ data: screenshotData, mimeType: 'image/png' }], VISION_EXECUTOR_SYSTEM_PROMPT)
      : this.aiClient.sendMessage(messages, EXECUTOR_SYSTEM_PROMPT)

    const response = await Promise.race([
      aiCall,
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('AI response timed out after 60s')), AI_TIMEOUT_MS))
    ])

    let action: CDPAction
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON in executor response')
      action = JSON.parse(jsonMatch[0]) as CDPAction
    } catch {
      action = { type: 'js_execute', code: `console.log("Step: ${stepDescription}")` }
    }

    const isSensitive = plan.sensitiveActions.some((s) =>
      stepDescription.toLowerCase().includes(s.toLowerCase())
    ) || (action.type === 'navigate' && action.url?.includes('submit'))

    // Check approval mode
    const needsApproval =
      this.approvalMode === 'always' ||
      (this.approvalMode === 'sensitive' && isSensitive)

    if (needsApproval) {
      const approved = await this.requestApproval(stepDescription)
      if (!approved) {
        this.addAction(task, {
          type: action.type,
          description: `Skipped (denied by user): ${stepDescription}`,
          status: 'failed'
        })
        return
      }
    }

    const agentAction = this.addAction(task, {
      type: action.type,
      description: (action as { description?: string }).description || stepDescription,
      selector: action.selector,
      value: action.value,
      url: action.url,
      code: action.code,
      status: 'running'
    })

    const bannerDetail = (action.url || action.value || action.selector || stepDescription)
      .toString()
      .substring(0, 60)
    await this.setBanner(`${this.bannerVerb(action.type)} · ${bannerDetail}`)

    try {
      const result = await this.cdpController.executeAction(tabId, action)
      agentAction.status = 'completed'
      agentAction.result = result
      this.emit('action', agentAction)

      // When the agent navigates, explicitly reveal the tab's native view
      // so the user sees the page live (the CDP debugger may not trigger
      // the did-start-navigation event reliably).
      if (action.type === 'navigate') {
        this.tabManager.revealActiveTab()
      }

      if (action.selector) {
        await this.contentExtractor.highlightElement(webContents, action.selector)
      }

      await new Promise((r) => setTimeout(r, 500))
    } catch (error: unknown) {
      agentAction.status = 'failed'
      agentAction.result = error instanceof Error ? error.message : String(error)
      this.emit('action', agentAction)
      throw error
    }
  }

  private addAction(task: AgentTask, partial: Partial<AgentAction>): AgentAction {
    const action: AgentAction = {
      id: crypto.randomUUID(),
      type: partial.type || 'wait',
      description: partial.description || '',
      selector: partial.selector,
      value: partial.value,
      url: partial.url,
      code: partial.code,
      status: partial.status || 'pending',
      result: partial.result,
      timestamp: Date.now(),
      requiresApproval: partial.requiresApproval
    }
    task.actions.push(action)
    this.emit('action', action)
    return action
  }

  private bannerVerb(type: CDPAction['type']): string {
    switch (type) {
      case 'navigate': return 'navigating'
      case 'click': return 'clicking'
      case 'type': return 'typing'
      case 'scroll': return 'scrolling'
      case 'extract': return 'reading'
      case 'screenshot': return 'capturing'
      case 'js_execute': return 'running script'
      case 'wait': return 'waiting'
      default: return 'working'
    }
  }

  private async setBanner(text: string): Promise<void> {
    const tab = this.tabManager.getActiveTab()
    if (!tab) return
    try {
      await this.contentExtractor.showAgentBanner(tab.view.webContents, text)
    } catch {
      /* page may be mid-navigation */
    }
  }

  private async clearBanner(): Promise<void> {
    const tab = this.tabManager.getActiveTab()
    if (!tab) return
    try {
      await this.contentExtractor.hideAgentBanner(tab.view.webContents)
    } catch {
      /* page may be gone */
    }
  }

  async requestApproval(description: string): Promise<boolean> {
    this.emit('approval-request', description)
    return new Promise<boolean>((resolve) => {
      this.approvalResolver = resolve
    })
  }

  approveAction(): void {
    if (this.approvalResolver) {
      this.approvalResolver(true)
      this.approvalResolver = null
    }
  }

  denyAction(): void {
    if (this.approvalResolver) {
      this.approvalResolver(false)
      this.approvalResolver = null
    }
  }

  pause(): void {
    this.isPaused = true
    if (this.task) {
      this.task.status = 'paused'
      this.emit('status', this.task)
    }
  }

  resume(): void {
    this.isPaused = false
    if (this.task) {
      this.task.status = 'running'
      this.emit('status', this.task)
    }
  }

  stop(): void {
    this.isStopped = true
    this.isPaused = false
    void this.clearBanner()
    if (this.task) {
      this.task.status = 'stopped'
      this.task.endTime = Date.now()
      this.emit('status', this.task)
    }
  }

  getTask(): AgentTask | null {
    return this.task
  }

  getStatus(): { isRunning: boolean; isPaused: boolean; task: AgentTask | null } {
    return {
      isRunning: this.task?.status === 'running' || this.task?.status === 'planning',
      isPaused: this.isPaused,
      task: this.task
    }
  }
}
