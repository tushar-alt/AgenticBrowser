import React, { useState, useRef, useEffect } from 'react'
import { Plus, MessageSquare, Bot, Settings, CornerDownLeft, ChevronRight, Clock, Star } from 'lucide-react'
import { useTabStore } from '../../store/tabStore'
import { useAgentStore } from '../../store/agentStore'
import { useSettingsStore } from '../../store/settingsStore'
import { useHistoryStore } from '../../store/historyStore'

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
  onToggleChat: () => void
  onToggleSupervisor: () => void
  onShowHistory: () => void
  onShowBookmarks: () => void
}

interface Command {
  id: string
  label: string
  description: string
  icon: React.ReactNode
  action: () => void
  category: string
}

export function CommandPalette({ isOpen, onClose, onToggleChat, onToggleSupervisor, onShowHistory, onShowBookmarks }: CommandPaletteProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const { tabs, switchTab, createTab, activeTabId } = useTabStore()
  const { startAgent, isRunning } = useAgentStore()
  const { history, bookmarks, loadHistory, loadBookmarks } = useHistoryStore()

  useEffect(() => {
    if (isOpen) {
      loadHistory()
      loadBookmarks()
    }
  }, [isOpen])

  const commands: Command[] = [
    {
      id: 'new-tab',
      label: 'New Tab',
      description: 'Open a new browser tab',
      icon: <Plus size={15} />,
      action: () => { createTab(); onClose() },
      category: 'browser'
    },
    ...tabs.map((tab) => ({
      id: `tab-${tab.id}`,
      label: tab.isNewTab ? 'New Tab' : tab.title || 'Untitled',
      description: tab.isNewTab ? 'start page' : tab.url,
      icon: <ChevronRight size={15} className={tab.id === activeTabId ? 'text-accent' : ''} />,
      action: () => { switchTab(tab.id); onClose() },
      category: 'tabs'
    })),
    {
      id: 'show-history',
      label: 'Show History',
      description: 'View and search browsing history',
      icon: <Clock size={15} />,
      action: () => { onShowHistory(); onClose() },
      category: 'browser'
    },
    {
      id: 'show-bookmarks',
      label: 'Show Bookmarks',
      description: 'View and manage saved bookmarks',
      icon: <Star size={15} />,
      action: () => { onShowBookmarks(); onClose() },
      category: 'browser'
    },
    {
      id: 'toggle-chat',
      label: 'Toggle Chat',
      description: 'Show or hide the AI chat panel',
      icon: <MessageSquare size={15} />,
      action: () => { onToggleChat(); onClose() },
      category: 'panels'
    },
    {
      id: 'toggle-agent',
      label: 'Toggle Agent',
      description: 'Show or hide the agent supervisor',
      icon: <Bot size={15} />,
      action: () => { onToggleSupervisor(); onClose() },
      category: 'panels'
    },
    {
      id: 'open-settings',
      label: 'Open Settings',
      description: 'Configure AI providers and preferences',
      icon: <Settings size={15} />,
      action: () => { useSettingsStore.getState().openSettings(); onClose() },
      category: 'settings'
    }
  ]

  if (query.startsWith('>')) {
    const agentGoal = query.slice(1).trim()
    if (agentGoal && !isRunning) {
      commands.unshift({
        id: 'run-agent',
        label: `Run agent: "${agentGoal}"`,
        description: 'Start an AI agent task',
        icon: <Bot size={15} className="text-accent" />,
        action: () => { startAgent(agentGoal); onToggleSupervisor(); onClose() },
        category: 'agent'
      })
    }
  }

  // When user is typing a search query, also search through history and bookmarks
  const historyCommands: Command[] = []
  const bookmarkCommands: Command[] = []

  if (query && !query.startsWith('>')) {
    const q = query.toLowerCase()

    const matchingHistory = history
      .filter((h) => h.title.toLowerCase().includes(q) || h.url.toLowerCase().includes(q))
      .slice(0, 5)

    for (const entry of matchingHistory) {
      historyCommands.push({
        id: `history-${entry.id}`,
        label: entry.title || 'Untitled',
        description: entry.url,
        icon: <Clock size={15} className="text-muted" />,
        action: () => {
          const activeId = useTabStore.getState().activeTabId
          if (activeId) {
            useTabStore.getState().navigateTab(activeId, entry.url)
          }
          onClose()
        },
        category: 'history'
      })
    }

    const matchingBookmarks = bookmarks
      .filter((b) => b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q))
      .slice(0, 5)

    for (const entry of matchingBookmarks) {
      bookmarkCommands.push({
        id: `bookmark-${entry.id}`,
        label: entry.title || 'Untitled',
        description: entry.url,
        icon: <Star size={15} className="text-accent" />,
        action: () => {
          const activeId = useTabStore.getState().activeTabId
          if (activeId) {
            useTabStore.getState().navigateTab(activeId, entry.url)
          }
          onClose()
        },
        category: 'bookmark'
      })
    }
  }

  const allCommands = [...bookmarkCommands, ...historyCommands, ...commands]

  const filtered = query
    ? allCommands.filter(
        (c) =>
          c.label.toLowerCase().includes(query.toLowerCase()) ||
          c.description.toLowerCase().includes(query.toLowerCase())
      )
    : commands

  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      e.preventDefault()
      filtered[selectedIndex].action()
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  if (!isOpen) return <></>

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh] bg-ink/60 fade-in" onClick={onClose}>
      <div
        className="w-[540px] bg-panel rounded-xl border border-line shadow-lift overflow-hidden fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-line">
          <span className="font-mono text-accent">{'>'}</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command… prefix with > for agent tasks"
            className="flex-1 bg-transparent text-sm text-cream placeholder-muted/60 outline-none font-mono"
          />
        </div>

        <div className="max-h-[320px] overflow-y-auto py-1.5">
          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-muted text-sm font-mono">no matching commands</div>
          )}
          {filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              className={`w-full text-left px-4 py-2 flex items-center gap-3 transition-colors ${
                i === selectedIndex ? 'bg-accent/10' : 'hover:bg-panel-2'
              }`}
              onClick={cmd.action}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className={`flex-shrink-0 ${i === selectedIndex ? 'text-accent' : 'text-muted'}`}>{cmd.icon}</span>
              <div className="flex-1 min-w-0">
                <div className={`text-sm truncate ${i === selectedIndex ? 'text-cream' : 'text-cream/85'}`}>{cmd.label}</div>
                <div className="text-[11px] text-muted truncate font-mono">{cmd.description}</div>
              </div>
              <span className="term-label flex-shrink-0">{cmd.category}</span>
            </button>
          ))}
        </div>

        <div className="px-4 py-2.5 border-t border-line flex items-center gap-4 text-[11px] text-muted font-mono">
          <span>↑↓ navigate</span>
          <span className="flex items-center gap-1"><CornerDownLeft size={11} /> select</span>
          <span>esc close</span>
          <span className="ml-auto text-accent">&gt; = agent task</span>
        </div>
      </div>
    </div>
  )
}
