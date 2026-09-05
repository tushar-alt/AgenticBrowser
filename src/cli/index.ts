#!/usr/bin/env node
/**
 * AgenticBrowser CLI — BrowserOS-style agent browsing from any terminal.
 *
 * Every command talks to a persistent (detached) headless Chrome session and
 * outputs AI-ready JSON by default.
 *
 *   agentic open <url>            open URL in the active tab
 *   agentic newtab <url>          open URL in a new tab
 *   agentic info [--selector CSS] [--text-limit N] [--out FILE]
 *   agentic text [--selector CSS]
 *   agentic links | forms | tables | images
 *   agentic click <ref|css>
 *   agentic type <ref|css> <value>
 *   agentic scroll <up|down> [px]
 *   agentic screenshot [--file FILE]
 *   agentic tabs | tab <n> | back | close [n] | close-browser
 *   agentic ask "<question>"      LLM answers a question about the current page
 *   agentic run "<task>" [--steps N]   natural-language agent loop
 */
import fs from 'fs'
import {
  connectBrowser,
  waitLoad,
  createTab,
  closeTab,
  killBrowser,
  switchActiveTab,
  readSession,
  type CDPSession
} from './cdp'
import { extractionScript, type PageJSON } from '../shared/pageJson'
import { runTask, askPage } from './agent'

interface ParsedArgs {
  cmd: string
  args: string[]
  flags: Record<string, string | boolean>
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {}
  const positional: string[] = []
  let i = 0
  while (i < argv.length) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.replace(/^--/, '')
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        flags[key] = argv[i + 1]
        i += 2
      } else {
        flags[key] = true
        i++
      }
    } else {
      positional.push(a)
      i++
    }
  }
  const [cmd, ...args] = positional
  return { cmd: cmd || 'help', args, flags }
}

function out(data: unknown, flags: ParsedArgs['flags']): void {
  const json = JSON.stringify(data, null, 2)
  const file = typeof flags.out === 'string' ? flags.out : ''
  if (file) {
    fs.writeFileSync(file, json)
    console.error(`written to ${file}`) // stderr: piping-safe
  } else {
    console.log(json)
  }
}

function die(e: unknown): never {
  console.error('error: ' + (e instanceof Error ? e.message : String(e)))
  process.exit(1)
}

const HELP = `AgenticBrowser CLI — CLI-first, BrowserOS-style agent browsing.

Usage: agentic <command> [args] [--flags]

Session & navigation
  open <url>                 navigate the active tab to <url>
  newtab <url>               open <url> in a new tab and switch to it
  tabs                       list tabs (idx, title, url)
  tab <n>                    make tab n active
  back                       go back in history
  close [n]                  close tab n (default: active tab)
  close-browser              quit the background browser session

Read (all output AI-ready JSON; --out FILE writes to file)
  info [--selector CSS] [--text-limit N]     full structured page JSON
  text [--selector CSS]                      page text only
  links | forms | tables | images            single slices of the page JSON

Act
  click <ref|css-selector>   click element (ref like e12 from info, or CSS)
  type <ref|css-selector> "<value>"   clear + type into input, fires events
  scroll <up|down> [px]      scroll the page
  screenshot [--file FILE]   PNG capture (default: agentic-<ts>.png)

Agent (needs OPENAI_API_KEY / ANTHROPIC_API_KEY or local Ollama)
  ask "<question>"           one-shot question answered from current page JSON
  run "<task>" [--steps N]   natural-language multi-step browser task

Flags
  --fresh                    kill and relaunch the background browser
  --headful                  launch browser with a visible window
  --chrome PATH              browser executable override
  --json                     (ask/run) output raw JSON instead of text

Examples
  agentic open https://news.ycombinator.com
  agentic info --out page.json
  agentic click e12
  agentic run "find the top 5 stories on hacker news and list their titles"
`

async function requireSession(flags: ParsedArgs['flags']) {
  const handle = await connectBrowser({
    fresh: flags.fresh === true,
    headful: flags.headful === true,
    chrome: typeof flags.chrome === 'string' ? flags.chrome : undefined
  }).catch(die)
  return handle
}

async function main(): Promise<void> {
  const { cmd, args, flags } = parseArgs(process.argv.slice(2))

  if (cmd === 'help' || flags.help === true) {
    console.log(HELP)
    return
  }

  if (cmd === 'close-browser') {
    const s = readSession()
    if (!s) { console.log('No running browser session'); return }
    killBrowser(s.pid)
    console.log('Browser closed (pid ' + s.pid + ')')
    return
  }

  if (cmd === 'tabs') {
    const h = await requireSession(flags)
    h.session.close()
    const { port, activeTab } = h.sessionInfo
    const targets = await listTargets(port)
    console.log(JSON.stringify({ activeTab, tabs: targets }, null, 2))
    return
  }

  if (cmd === 'tab') {
    const n = Number(args[0])
    if (!Number.isInteger(n)) die('usage: agentic tab <n>')
    await switchActiveTab(n)
    console.log('Active tab set to ' + n)
    return
  }

  const handle = await requireSession(flags)
  let session = handle.session
  let sessionInfo = handle.sessionInfo

  try {
    switch (cmd) {
      case 'open': {
        const url = normalizeUrl(args[0])
        if (!url) die('usage: agentic open <url>')
        await session.send('Page.navigate', { url }, 45000)
        await waitLoad(session)
        const page = await getPageJson(session)
        // JSON-only stdout: title already in the emitted page JSON
        out(page, flags)
        break
      }
      case 'newtab': {
        const url = normalizeUrl(args[0] || 'about:blank')
        const t = await createTab(sessionInfo.port, url)
        const targets = await listTargets(sessionInfo.port)
        const idx = targets.findIndex((x) => x.id === t.id)
        await switchActiveTab(idx < 0 ? targets.length - 1 : idx)
        session.close()
        const fresh = await requireSession({})
        session = fresh.session
        sessionInfo = fresh.sessionInfo
        await waitLoad(session)
        const page = await getPageJson(session)
        // JSON-only stdout
        out(page, flags)
        break
      }
      case 'info': {
        const page = await getPageJson(session, {
          textLimit: flags['text-limit'] ? Number(flags['text-limit']) : undefined
        })
        out(typeof flags.selector === 'string' ? await sliceSelector(session, flags.selector, page) : page, flags)
        break
      }
      case 'text': {
        const expr = typeof flags.selector === 'string' && flags.selector
          ? `document.querySelector('${flags.selector.replace(/'/g, "\\'")}')?.innerText || ''`
          : 'document.body.innerText'
        console.log(JSON.stringify({ url: await pageLocation(session), text: await session.evaluate<string>(expr) }, null, 2))
        break
      }
      case 'links': {
        const page = await getPageJson(session, { textLimit: 0 })
        out({ url: page.url, title: page.title, links: page.links }, flags)
        break
      }
      case 'forms': {
        const page = await getPageJson(session, { textLimit: 0 })
        out({ url: page.url, title: page.title, forms: page.forms }, flags)
        break
      }
      case 'tables': {
        const page = await getPageJson(session, { textLimit: 0 })
        out({ url: page.url, title: page.title, tables: page.tables }, flags)
        break
      }
      case 'images': {
        const page = await getPageJson(session, { textLimit: 0 })
        out({ url: page.url, title: page.title, images: page.images }, flags)
        break
      }
      case 'click': {
        if (!args[0]) die('usage: agentic click <ref|css-selector>')
        const selector = refToSelector(args[0])
        await session.evaluate(clickScript(selector))
        await new Promise((r) => setTimeout(r, 800))
        const page = await getPageJson(session, { textLimit: 1200 })
        // JSON-only stdout
        out(page, flags)
        break
      }
      case 'type': {
        const ref = args[0]
        const value = args.slice(1).join(' ')
        if (!ref || !value) die('usage: agentic type <ref|css-selector> "<value>"')
        await session.evaluate(typeScript(refToSelector(ref), value))
        // JSON-only stdout
        out({ ok: true, ref, value }, flags)
        break
      }
      case 'scroll': {
        const dir = args[0] === 'up' ? -1 : 1
        const amt = Number(args[1]) || 600
        await session.evaluate(`window.scrollBy(0, ${dir * amt})`)
        out({ ok: true, direction: dir === 1 ? 'down' : 'up', amount: amt }, flags)
        break
      }
      case 'screenshot': {
        const res = (await session.send('Page.captureScreenshot', { format: 'png' })) as { data?: string }
        if (!res.data) die('screenshot failed')
        const file = typeof flags.file === 'string' ? flags.file : `agentic-${Date.now()}.png`
        fs.writeFileSync(file, Buffer.from(res.data, 'base64'))
        console.log(JSON.stringify({ ok: true, file, bytes: res.data.length * 0.75 | 0 }))
        break
      }
      case 'back': {
        await session.evaluate('history.back()')
        await waitLoad(session)
        out({ ok: true }, flags)
        break
      }
      case 'close': {
        const n = args[0] !== undefined ? Number(args[0]) : sessionInfo.activeTab
        const targets = await listTargets(sessionInfo.port)
        const t = targets[Math.min(Math.max(n, 0), targets.length - 1)]
        if (!t) die('no such tab')
        await closeTab(sessionInfo.port, t.id)
        if (n === sessionInfo.activeTab) await switchActiveTab(0)
        console.log('closed tab #' + n)
        break
      }
      case 'ask': {
        const q = args.join(' ')
        if (!q) die('usage: agentic ask "<question>"')
        const answer = await askPage(session, q)
        out({ answer }, flags) // JSON-only stdout
        break
      }
      case 'run': {
        const task = args.join(' ')
        if (!task) die('usage: agentic run "<task>"')
        const steps = flags.steps ? Number(flags.steps) : 15
        const result = await runTask(session, task, steps)
        out(result, flags) // JSON-only stdout
        break
      }
      default:
        console.error('unknown command: ' + cmd + '\n')
        console.log(HELP)
        process.exitCode = 1
    }
  } finally {
    session.close()
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function normalizeUrl(u?: string): string {
  if (!u) return ''
  if (/^https?:\/\//i.test(u)) return u
  if (u.includes('.') && !u.includes(' ')) return 'https://' + u
  return u // let the browser treat it as a search / about: page
}

async function pageLocation(session: CDPSession): Promise<string> {
  return session.evaluate<string>('location.href')
}

async function listTargets(port: number): Promise<Array<{ idx: number; id: string; title: string; url: string }>> {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`)
  const list = (await res.json()) as Array<{ type: string; id: string; title: string; url: string }>
  return list.filter((t) => t.type === 'page').map((t, i) => ({ idx: i, id: t.id, title: t.title, url: t.url }))
}

function refToSelector(ref: string): string {
  const m = ref.match(/^[eE](\d+)$/)
  if (!m) return ref
  return `[data-ab-ref="e${m[1]}"]`
}

async function getPageJson(session: CDPSession, opts: { textLimit?: number } = {}): Promise<PageJSON> {
  return session.evaluate<PageJSON>(extractionScript({ textLimit: opts.textLimit }))
}

async function sliceSelector(session: CDPSession, selector: string, page: PageJSON): Promise<unknown> {
  const escaped = selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const html = await session.evaluate<string>(`document.querySelector('${escaped}')?.outerHTML || ''`)
  return { url: page.url, title: page.title, selector, html }
}

function clickScript(selector: string): string {
  return `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Element not found: ' + ${JSON.stringify(selector)});
      el.scrollIntoView({ behavior: 'instant', block: 'center' });
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: cx, clientY: cy }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: cx, clientY: cy }));
      return true;
    })()
  `
}

function typeScript(selector: string, value: string): string {
  const val = JSON.stringify(value)
  return `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Element not found: ' + ${JSON.stringify(selector)});
      el.scrollIntoView({ behavior: 'instant', block: 'center' });
      el.focus();
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.value = ${val};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()
  `
}

main().catch(die)
