/**
 * CLI agent loop: natural-language task -> LLM -> one JSON action per step ->
 * executed via CDP -> result fed back, until the model returns {"action":"done"}.
 *
 * BYOK: provider/key resolved from environment variables, mirroring the
 * Electron app's BYOK philosophy (no keys ever stored by the CLI):
 *   OPENAI_API_KEY     -> OpenAI (default model gpt-4o-mini)
 *   ANTHROPIC_API_KEY  -> Anthropic (default model claude-3-5-haiku-latest)
 *   AGENTIC_PROVIDER / AGENTIC_MODEL override. Ollama at localhost:11434 is
 *   used when no key is present (default model llama3.2).
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { CDPSession, waitLoad } from './cdp'
import { extractionScript, summarizePageJson, type PageJSON } from '../shared/pageJson'

export interface AgentStep {
  step: number
  thought: string
  action: Action
  result: string
  ok: boolean
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ProviderCfg {
  name: string
  model: string
  style: 'anthropic' | 'openai'
  baseURL: string
  apiKey: string
}

/**
 * Optional zero-config provider: reuse an enabled provider from the local
 * ZCode config (~/.zcode/v2/config.json) so the CLI works out of the box
 * wherever ZCode is installed. Env vars always take precedence.
 */
/**
 * Optional zero-config providers from the local ZCode config
 * (~/.zcode/v2/config.json), ordered so a provider offering GLM-5.3-Flash
 * comes first. Env vars always take precedence (handled in resolveProviderChain).
 */
function loadZCodeProviders(): ProviderCfg[] {
  const out: ProviderCfg[] = []
  try {
    const file = process.env.ZCODE_CONFIG || path.join(os.homedir(), '.zcode', 'v2', 'config.json')
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      provider?: Record<string, {
        name?: string
        kind?: string
        enabled?: boolean
        options?: { apiKey?: string; baseURL?: string }
        models?: Record<string, unknown>
      }>
    }
    for (const p of Object.values(cfg.provider || {})) {
      if (p?.enabled === false || !p?.options?.apiKey || !p?.options?.baseURL) continue
      const models = Object.keys(p.models || {})
      if (models.length === 0) continue
      out.push({
        name: p.name || 'zcode',
        model: models.includes('GLM-5.3-Flash') ? 'GLM-5.3-Flash' : models[0],
        style: p.kind === 'anthropic' ? 'anthropic' : 'openai',
        baseURL: p.options.baseURL,
        apiKey: p.options.apiKey
      })
    }
    out.sort((a, b) => {
      const flash = (p: ProviderCfg) => (p.model === 'GLM-5.3-Flash' ? 0 : 1)
      return flash(a) - flash(b)
    })
  } catch { /* no config -> skip */ }
  return out
}

function resolveProviderChain(): Array<ProviderCfg & { call: (messages: ChatMessage[]) => Promise<string> }> {
  const chain: Array<ProviderCfg & { call: (messages: ChatMessage[]) => Promise<string> }> = []
  // 1. Explicit custom endpoint (AGENTIC_API_KEY + AGENTIC_BASE_URL [+ AGENTIC_MODEL, AGENTIC_STYLE])
  if (process.env.AGENTIC_API_KEY && process.env.AGENTIC_BASE_URL) {
    const style = (process.env.AGENTIC_STYLE || 'anthropic').toLowerCase() === 'openai' ? 'openai' : 'anthropic'
    const model = process.env.AGENTIC_MODEL || 'default'
    chain.push({ name: 'custom', model, style, baseURL: process.env.AGENTIC_BASE_URL, apiKey: process.env.AGENTIC_API_KEY, call: (m) => callChat('custom', style, process.env.AGENTIC_BASE_URL!, process.env.AGENTIC_API_KEY!, model, m) })
  }
  if (process.env.AGENTIC_PROVIDER?.toLowerCase() === 'openai' || (!process.env.AGENTIC_PROVIDER && process.env.OPENAI_API_KEY)) {
    const key = process.env.OPENAI_API_KEY
    if (!key) throw new Error('AGENTIC_PROVIDER=openai but OPENAI_API_KEY is not set')
    const model = process.env.AGENTIC_MODEL || 'gpt-4o-mini'
    chain.push({ name: 'openai', model, style: 'openai', baseURL: 'https://api.openai.com/v1', apiKey: key, call: (m) => callChat('openai', 'openai', 'https://api.openai.com/v1', key, model, m) })
  }
  if (process.env.AGENTIC_PROVIDER?.toLowerCase() === 'anthropic' || (!process.env.AGENTIC_PROVIDER && process.env.ANTHROPIC_API_KEY)) {
    const key = process.env.ANTHROPIC_API_KEY
    if (!key) throw new Error('AGENTIC_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set')
    const model = process.env.AGENTIC_MODEL || 'claude-3-5-haiku-latest'
    chain.push({ name: 'anthropic', model, style: 'anthropic', baseURL: 'https://api.anthropic.com', apiKey: key, call: (m) => callChat('anthropic', 'anthropic', 'https://api.anthropic.com', key, model, m) })
  }
  // 2. Local ZCode config providers (zero-config on machines with ZCode installed)
  for (const zcode of loadZCodeProviders()) {
    chain.push({ ...zcode, call: (m) => callChat(zcode.name, zcode.style, zcode.baseURL, zcode.apiKey, zcode.model, m) })
  }
  // 3. Local Ollama as last resort
  const base = process.env.OLLAMA_HOST || 'http://localhost:11434'
  const ollamaModel = process.env.AGENTIC_MODEL || 'llama3.2'
  chain.push({ name: 'ollama', model: ollamaModel, style: 'openai', baseURL: base, apiKey: '', call: (m) => callOllama(base, m) })
  return chain
}

/** Call every provider in the chain until one answers; rethrow the last error. */
async function callWithFallback(messages: ChatMessage[]): Promise<{ text: string; provider: string }> {
  const chain = resolveProviderChain()
  let lastErr: Error | null = null
  for (const p of chain) {
    try {
      const text = await p.call(messages)
      if (!text.trim()) throw new Error('empty response')
      return { text, provider: p.name + '/' + p.model }
    } catch (e) {
      lastErr = e as Error
    }
  }
  throw new Error(`LLM call failed on all providers; last error: ${lastErr?.message || 'unknown'}`)
}

async function callChat(
  name: string,
  style: 'anthropic' | 'openai',
  baseURL: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[]
): Promise<string> {
  const base = baseURL.replace(/\/+$/, '')
  if (style === 'openai') {
    const url = base.endsWith('/chat/completions') ? base : base + '/chat/completions'
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({ model, messages, max_tokens: 1024 })
    })
    if (!res.ok) throw new Error(`${name} API ${res.status}: ${(await res.text()).substring(0, 300)}`)
    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> }
    return data.choices[0]?.message?.content || ''
  }
  // Anthropic-style messages API
  const url = base.endsWith('/messages') ? base : base + '/v1/messages'
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n')
  const rest = messages.filter((m) => m.role !== 'system')
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      system,
      messages: rest.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: 1024
    })
  })
  if (!res.ok) throw new Error(`${name} API ${res.status}: ${(await res.text()).substring(0, 300)}`)
  const data = (await res.json()) as { content: Array<{ type: string; text?: string }> }
  return (data.content || []).filter((c) => c.type === 'text').map((c) => c.text || '').join('')
}

async function callOllama(base: string, messages: ChatMessage[]): Promise<string> {
  // Tool-calling bridge for small local models: Ollama's format:"json"
  // constrains decoding so even models WITHOUT native tool support emit
  // parseable JSON actions.
  const res = await fetch(base.replace(/\/$/, '') + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.AGENTIC_MODEL || 'llama3.2', messages, stream: false, format: 'json' })
  })
  if (!res.ok) throw new Error(`Ollama API ${res.status}: ${(await res.text()).substring(0, 300)}`)
  const data = (await res.json()) as { message: { content: string } }
  return data.message?.content || ''
}

const SYSTEM_PROMPT = `You are a browser automation agent driving a real Chrome instance over the Chrome DevTools Protocol.

Every reply must be EXACTLY one JSON object, no prose, no markdown fences:
{
  "thought": "brief reasoning about what to do next",
  "action": {
    "type": "navigate" | "click" | "type" | "scroll" | "wait" | "info" | "done",
    "url": "...",        // navigate
    "text": "...",       // type (element ref required)
    "ref": "e12",        // click/type target: an element ref from the page JSON
    "direction": "down", // scroll: up|down
    "amount": 600,       // scroll pixels
    "ms": 2000,          // wait
    "summary": "..."     // done: what you accomplished
  }
}

Action types:
- navigate {url}: go to a URL in the current tab
- click {ref}: click an element by ref
- type {ref, text}: clear and type text into an input by ref, then press through
- scroll {direction, amount}
- wait {ms}
- info: re-extract the full page JSON (use when the page changed after clicking)
- done {summary}: task complete - ALWAYS finish with this after the goal is met

Rules:
- After navigate or click that changes the page, you receive fresh page JSON. Use refs from the LATEST JSON only.
- Prefer clicking links by their ref. Never invent refs.
- If a page seems unchanged or an action failed, try info or a different approach; do not repeat the same failing action more than twice.
- When you have gathered/verified what the task needs, return done with a concise summary.`

interface Action {
  type: string
  url?: string
  text?: string
  ref?: string
  direction?: string
  amount?: number
  ms?: number
  summary?: string
}

function parseAction(raw: string): { thought: string; action: Action } {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()

  // balanced-brace extraction (survives prose around the JSON and nested braces)
  const start = text.indexOf('{')
  if (start === -1) throw new Error('Agent did not return JSON: ' + raw.substring(0, 200))
  let depth = 0
  let end = -1
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (esc) { esc = false; continue }
    if (ch === '\\') { esc = true; continue }
    if (ch === '"') inStr = !inStr
    if (inStr) continue
    if (ch === '{') depth++
    if (ch === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end === -1) {
    // repair truncated output: close open strings/braces
    text = text.substring(start)
    text = text.replace(/,\s*$/, '')
    text += '"}'.repeat(1)
    text = text.replace(/([\w"])\s*$/, '$1}')
    while (depth > 0) { text += '}'; depth-- }
    try {
      const obj = JSON.parse(text) as { thought?: string; action?: Action }
      return normalizeAction(obj, raw)
    } catch { /* fall through */ }
    throw new Error('Agent did not return JSON: ' + raw.substring(0, 200))
  }

  let body = text.substring(start, end + 1)
  // repair trailing commas
  body = body.replace(/,\s*([}\]])/g, '$1')
  const obj = JSON.parse(body) as { thought?: string; action?: Action }
  return normalizeAction(obj, raw)
}

/** Accept both {action:{...}} and flat {type,...}, and fill a missing type. */
function normalizeAction(obj: { thought?: string; action?: Action }, raw: string): { thought: string; action: Action } {
  let action = obj.action
  if (!action && (obj as unknown as Action).type) {
    action = obj as unknown as Action
  }
  if (!action || !action.type) throw new Error('Agent JSON missing action: ' + raw.substring(0, 200))
  return { thought: obj.thought || '', action }
}

/** Normalize a ref like "e12" to the attribute selector used by the extractor. */
function refToSelector(ref: string): string {
  const m = ref.match(/^[eE](\d+)$/)
  if (!m) return ref
  return `[data-ab-ref="e${m[1]}"]`
}

async function getPageJson(session: CDPSession, opts: { textLimit?: number } = {}): Promise<PageJSON> {
  return session.evaluate<PageJSON>(extractionScript({ textLimit: opts.textLimit ?? 6000 }))
}

async function executeAction(session: CDPSession, action: Action): Promise<string> {
  switch (action.type) {
    case 'navigate': {
      if (!action.url) return 'ERROR: navigate requires url'
      await session.send('Page.navigate', { url: action.url }, 45000)
      await waitLoad(session)
      const page = await getPageJson(session, { textLimit: 1500 })
      return 'Page after navigate:\n' + summarizePageJson(page)
    }
    case 'click': {
      if (!action.ref) return 'ERROR: click requires ref'
      const selector = refToSelector(action.ref)
      await session.evaluate(`
        (() => {
          const el = document.querySelector('${selector}');
          if (!el) throw new Error('No element with data-ab-ref=${action.ref}');
          el.scrollIntoView({ behavior: 'instant', block: 'center' });
          const rect = el.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy }));
          el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: cx, clientY: cy }));
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: cx, clientY: cy }));
          return true;
        })()
      `)
      await new Promise((r) => setTimeout(r, 1200))
      const page = await getPageJson(session, { textLimit: 1200 })
      return 'Page after click:\n' + summarizePageJson(page)
    }
    case 'type': {
      if (!action.ref || !action.text) return 'ERROR: type requires ref and text'
      const selector = refToSelector(action.ref)
      const val = JSON.stringify(action.text)
      await session.evaluate(`
        (() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) throw new Error('No element with data-ab-ref=${action.ref}');
          el.scrollIntoView({ behavior: 'instant', block: 'center' });
          el.focus();
          el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.value = ${val};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()
      `)
      return `Typed ${JSON.stringify(action.text)} into ${action.ref}`
    }
    case 'scroll': {
      const dir = action.direction === 'up' ? -1 : 1
      const amt = typeof action.amount === 'number' ? action.amount : 600
      await session.evaluate(`window.scrollBy(0, ${dir * amt})`)
      return `Scrolled ${dir === 1 ? 'down' : 'up'} by ${amt}px`
    }
    case 'wait':
      await new Promise((r) => setTimeout(r, Math.min(action.ms || 1500, 15000)))
      return `Waited ${action.ms || 1500}ms`
    case 'info': {
      const page = await getPageJson(session)
      return 'Current page JSON:\n' + summarizePageJson(page)
    }
    case 'done':
      return action.summary || 'Task complete'
    default:
      return `ERROR: unknown action type "${action.type}"`
  }
}

export async function runTask(session: CDPSession, task: string, maxSteps = 15): Promise<{ steps: AgentStep[]; summary: string }> {
  const steps: AgentStep[] = []

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: 'Task: ' + task + '\n\nFirst, here is the current page:\n' + summarizePageJson(await getPageJson(session, { textLimit: 1500 })) }
  ]

  let summary = ''
  for (let step = 1; step <= maxSteps; step++) {
    let raw: string
    try {
      raw = (await callWithFallback(messages)).text
    } catch (e) {
      throw new Error((e as Error).message)
    }
    const { thought, action } = parseAction(raw)
    const result = await executeAction(session, action)
    steps.push({ step, thought, action, result, ok: !result.startsWith('ERROR') })
    if (process.env.AGENTIC_VERBOSE === '1') {
      console.error(`[step ${step}] ${thought || '-'}\n  -> ${action.type} ${JSON.stringify({ ...action, type: undefined })}\n  => ${result.substring(0, 200)}`)
    }
    if (action.type === 'done') {
      summary = result
      break
    }
    messages.push({ role: 'assistant', content: raw })
    messages.push({ role: 'user', content: 'Result:\n' + result + '\n\nContinue. Reply with exactly one JSON action object.' })
  }

  if (!summary) summary = `Stopped after ${maxSteps} steps without done. Last result: ${steps[steps.length - 1]?.result?.substring(0, 200) || 'none'}`
  return { steps, summary }
}

export async function askPage(session: CDPSession, question: string): Promise<string> {
  const page = await getPageJson(session)
  const messages: ChatMessage[] = [
    { role: 'system', content: 'You answer questions about the web page the user is looking at, using ONLY the structured page JSON provided. Be concise and factual. If the answer is not in the JSON, say so.' },
    { role: 'user', content: 'Page JSON:\n' + summarizePageJson(page) + '\n\nQuestion: ' + question }
  ]
  return (await callWithFallback(messages)).text
}
