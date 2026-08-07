import React, { useEffect, useMemo, useState } from 'react'
import { ArrowRight, CornerDownLeft, Play, Square, Sparkles, Settings, X, Plus } from 'lucide-react'
import { useTabStore } from '../../store/tabStore'
import { useAgentStore } from '../../store/agentStore'
import { useSettingsStore } from '../../store/settingsStore'
import { Shortcut } from '@shared/types'
import type { AssistantMode } from '../Assistant/AssistantPanel'

interface NewTabProps {
  onOpenAssistant: (mode: AssistantMode) => void
}

const DEFAULT_SHORTCUTS: Shortcut[] = [
  { id: '1', label: 'GitHub', url: 'https://github.com', tint: '#6e7681' },
  { id: '2', label: 'Gmail', url: 'https://mail.google.com', tint: '#ea4335' },
  { id: '3', label: 'YouTube', url: 'https://youtube.com', tint: '#ff0033' },
  { id: '4', label: 'Hacker News', url: 'https://news.ycombinator.com', tint: '#ff6600' },
  { id: '5', label: 'Wikipedia', url: 'https://wikipedia.org', tint: '#9b9aa3' },
  { id: '6', label: 'Reddit', url: 'https://reddit.com', tint: '#ff4500' }
]

const SUGGESTIONS = [
  '> find the top 5 trending repos today',
  '> book the cheapest flight to Lisbon',
  'summarize this page'
]

export function NewTab({ onOpenAssistant }: NewTabProps): React.JSX.Element {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const navigateTab = useTabStore((s) => s.navigateTab)
  const task = useAgentStore((s) => s.task)
  const isRunning = useAgentStore((s) => s.isRunning)
  const stopAgent = useAgentStore((s) => s.stopAgent)
  const startAgent = useAgentStore((s) => s.startAgent)
  const [query, setQuery] = useState('')
  const [shortcuts, setShortcuts] = useState<Shortcut[]>(DEFAULT_SHORTCUTS)
  const [editingShortcuts, setEditingShortcuts] = useState(false)
  const [newShortcut, setNewShortcut] = useState({ label: '', url: '', tint: '#6e7681' })

  const greeting = useMemo(() => {
    const h = new Date().getHours()
    if (h < 5) return 'Burning the midnight oil'
    if (h < 12) return 'Good morning'
    if (h < 18) return 'Good afternoon'
    return 'Good evening'
  }, [])

  const dateLabel = useMemo(
    () =>
      new Date()
        .toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
        .toUpperCase(),
    []
  )

  // Living clock — ticks every second so the canvas never feels frozen.
  const [clock, setClock] = useState(() => new Date().toLocaleTimeString([], { hour12: false }))
  useEffect(() => {
    const id = setInterval(() => setClock(new Date().toLocaleTimeString([], { hour12: false })), 1000)
    return () => clearInterval(id)
  }, [])

  // Real connection status, read from saved keys — ties the dashboard to live state.
  const keyStatus = useSettingsStore((s) => s.keyStatus)
  const aiProvider = useSettingsStore((s) => s.settings.aiProvider)
  const openSettings = useSettingsStore((s) => s.openSettings)
  const connected = keyStatus[aiProvider]

  // Load customizable shortcuts
  useEffect(() => {
    window.api.shortcuts.get().then((s) => {
      if (s && s.length > 0) setShortcuts(s)
    }).catch(() => {})
  }, [])

  const saveShortcuts = async (updated: Shortcut[]) => {
    setShortcuts(updated)
    await window.api.shortcuts.set(updated).catch(() => {})
  }

  const addShortcut = () => {
    if (!newShortcut.label.trim() || !newShortcut.url.trim()) return
    const id = crypto.randomUUID()
    saveShortcuts([...shortcuts, { ...newShortcut, id }])
    setNewShortcut({ label: '', url: '', tint: '#6e7681' })
  }

  const removeShortcut = (id: string) => {
    saveShortcuts(shortcuts.filter((s) => s.id !== id))
  }

  const isAgentQuery = query.trimStart().startsWith('>')

  const runAgent = (goal: string): void => {
    startAgent(goal)
    onOpenAssistant('agent')
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (!q || !activeTabId) return
    if (q.startsWith('>')) {
      const goal = q.slice(1).trim()
      if (goal) runAgent(goal)
      return
    }
    navigateTab(activeTabId, q)
  }

  const progress =
    task && task.plan.length > 0
      ? Math.min(100, Math.round((task.currentStep / task.plan.length) * 100))
      : 0

  return (
    <div className="ambient absolute inset-0 overflow-y-auto">
      <div className="ambient-glow" />
      <div className="relative z-10 min-h-full flex flex-col items-center justify-center px-6 py-16">
        <div className="w-full max-w-2xl fade-up">
          <div className="flex items-center gap-3 mb-6">
            <span className="term-label text-accent">{dateLabel}</span>
            <span className="h-px flex-1 bg-line" />
            <span className="term-label tabular-nums text-cream/70">{clock}</span>
          </div>

          <p className="text-muted text-sm mb-2">{greeting}.</p>
          <h1 className="font-mono text-4xl md:text-5xl font-semibold leading-[1.1] tracking-tight mb-8">
            What should we
            <br />
            <span className="text-accent">do today?</span>
          </h1>

          <form onSubmit={handleSubmit} className="group relative">
            <div
              className={`flex items-center gap-3 bg-panel border rounded-xl px-4 h-14 transition-all duration-200 ${
                isAgentQuery
                  ? 'border-accent shadow-glow'
                  : 'border-line focus-within:border-accent/70 focus-within:shadow-glow'
              }`}
            >
              <span
                className={`font-mono text-lg transition-colors ${
                  isAgentQuery ? 'text-accent' : 'text-muted'
                }`}
              >
                {isAgentQuery ? '▶' : '>'}
              </span>
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  isAgentQuery ? 'describe a task for the agent…' : 'search the web or type a URL…'
                }
                className="flex-1 bg-transparent outline-none text-cream placeholder-muted/60 font-mono text-[15px]"
              />
              <button
                type="submit"
                disabled={!query.trim()}
                className="flex items-center gap-1.5 h-9 px-3 rounded-lg bg-accent text-ink text-sm font-semibold
                           hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {isAgentQuery ? <Play size={15} /> : <ArrowRight size={16} />}
                {isAgentQuery ? 'Run' : 'Go'}
              </button>
            </div>
            <p className="mt-2.5 ml-1 text-xs text-muted/70 font-mono">
              prefix with <span className="text-accent">&gt;</span> to hand it to the agent
            </p>
          </form>

          <div className="flex flex-wrap gap-2 mt-5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setQuery(s)}
                className="px-3 py-1.5 rounded-full border border-line bg-panel/60 text-xs text-muted
                           hover:border-accent/60 hover:text-cream hover:bg-panel transition-all font-mono"
              >
                {s}
              </button>
            ))}
          </div>

          <button
            onClick={openSettings}
            className="group mt-4 flex items-center gap-2 text-[11px] font-mono transition-colors"
            title="Open settings"
          >
            <span className="term-label">status</span>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                connected ? 'bg-agent-running live-dot' : 'bg-muted/50'
              }`}
            />
            <span className={connected ? 'text-agent-running' : 'text-muted group-hover:text-cream'}>
              {connected
                ? `${aiProvider} · ready`
                : `no key for ${aiProvider} · tap to set up`}
            </span>
          </button>

          {task && (isRunning || task.status === 'paused') && (
            <div className="mt-10 fade-up">
              <div className="term-label mb-3">02 // RUNNING NOW</div>
              <div className="bg-panel border border-line rounded-xl p-4 hover:border-accent/40 transition-colors">
                <div className="flex items-start gap-3">
                  <span className="mt-1 w-2.5 h-2.5 rounded-full bg-agent-running live-dot flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-mono uppercase tracking-terminal text-agent-running">
                        Live
                      </span>
                      <span className="text-[10px] font-mono text-muted">
                        {task.status === 'paused' ? 'paused' : 'agent mode'}
                      </span>
                    </div>
                    <p className="text-sm text-cream truncate">{task.goal}</p>
                    <div className="mt-3 h-1 bg-panel-3 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent transition-all duration-500"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="mt-1.5 text-[11px] font-mono text-muted">
                      {task.plan.length > 0
                        ? `step ${Math.min(task.currentStep + 1, task.plan.length)}/${task.plan.length} · ${progress}%`
                        : 'planning…'}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => onOpenAssistant('agent')}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-panel-3 text-xs text-cream
                                 hover:bg-accent hover:text-ink transition-colors"
                    >
                      <Sparkles size={12} /> Watch
                    </button>
                    <button
                      onClick={() => stopAgent()}
                      className="flex items-center justify-center gap-1 px-2.5 py-1 rounded-md bg-panel-3 text-xs
                                 text-red-400 hover:bg-red-500/20 transition-colors"
                    >
                      <Square size={11} /> Stop
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="mt-10">
            <div className="flex items-center mb-3">
              <span className="term-label">
                {task && (isRunning || task.status === 'paused') ? '03' : '02'} // SHORTCUTS
              </span>
              <button
                onClick={() => setEditingShortcuts(!editingShortcuts)}
                className="ml-2 p-1 rounded text-muted hover:text-accent transition-colors"
                title="Customize shortcuts"
              >
                <Settings size={12} />
              </button>
            </div>

            {editingShortcuts && (
              <div className="mb-4 p-3 rounded-xl bg-panel-2 border border-line fade-up">
                <div className="text-xs text-muted font-mono mb-2">Add new shortcut:</div>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={newShortcut.label}
                    onChange={(e) => setNewShortcut({ ...newShortcut, label: e.target.value })}
                    placeholder="Label"
                    className="flex-1 bg-ink rounded px-2 py-1 text-xs text-cream border border-line outline-none focus:border-accent/60"
                  />
                  <input
                    type="text"
                    value={newShortcut.url}
                    onChange={(e) => setNewShortcut({ ...newShortcut, url: e.target.value })}
                    placeholder="URL"
                    className="flex-1 bg-ink rounded px-2 py-1 text-xs text-cream border border-line outline-none focus:border-accent/60 font-mono"
                  />
                  <input
                    type="color"
                    value={newShortcut.tint}
                    onChange={(e) => setNewShortcut({ ...newShortcut, tint: e.target.value })}
                    className="w-8 h-7 rounded cursor-pointer"
                  />
                  <button
                    onClick={addShortcut}
                    className="px-2 py-1 bg-accent text-ink text-xs font-semibold rounded hover:bg-accent-hover transition-colors"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {shortcuts.map((s) => (
                <div key={s.id} className="relative group">
                  <button
                    onClick={() => activeTabId && navigateTab(activeTabId, s.url)}
                    className="w-full flex flex-col items-center gap-2 py-3.5 rounded-xl border border-line bg-panel/50
                               hover:bg-panel hover:border-accent/40 hover:-translate-y-0.5 transition-all"
                  >
                    <span
                      className="w-9 h-9 rounded-lg flex items-center justify-center font-mono font-semibold text-ink"
                      style={{ background: s.tint }}
                    >
                      {s.label.charAt(0)}
                    </span>
                    <span className="text-[11px] text-muted group-hover:text-cream transition-colors truncate max-w-full px-1">
                      {s.label}
                    </span>
                  </button>
                  {editingShortcuts && (
                    <button
                      onClick={() => removeShortcut(s.id)}
                      className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center
                                 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                    >
                      <X size={10} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-12 flex items-center justify-center gap-2 text-[11px] font-mono text-muted/50">
            <CornerDownLeft size={12} />
            <span>local-first · your keys · your machine</span>
          </div>
        </div>
      </div>
    </div>
  )
}
