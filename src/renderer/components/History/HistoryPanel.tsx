import React, { useState, useEffect, useMemo } from 'react'
import { Clock, Trash2, X, Search, ExternalLink } from 'lucide-react'
import { useHistoryStore } from '../../store/historyStore'
import { HistoryEntry } from '@shared/types'

interface HistoryPanelProps {
  isOpen: boolean
  onClose: () => void
  onNavigate: (url: string) => void
}

type DateGroup = 'Today' | 'Yesterday' | 'Older'

function getDateGroup(timestamp: number): DateGroup {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 86400000

  if (timestamp >= startOfToday) return 'Today'
  if (timestamp >= startOfYesterday) return 'Yesterday'
  return 'Older'
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function HistoryPanel({ isOpen, onClose, onNavigate }: HistoryPanelProps): React.JSX.Element {
  const { history, loadHistory, removeHistoryEntry, clearHistory } = useHistoryStore()
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    if (isOpen) {
      loadHistory()
    }
  }, [isOpen])

  const filteredHistory = useMemo(() => {
    if (!searchQuery.trim()) return history || []
    const q = searchQuery.toLowerCase()
    return (history || []).filter(
      (h) => h.title.toLowerCase().includes(q) || h.url.toLowerCase().includes(q)
    )
  }, [history, searchQuery])

  const groupedHistory = useMemo(() => {
    const groups: Record<DateGroup, HistoryEntry[]> = {
      Today: [],
      Yesterday: [],
      Older: []
    }

    for (const entry of filteredHistory) {
      const group = getDateGroup(entry.timestamp)
      groups[group].push(entry)
    }

    return groups
  }, [filteredHistory])

  const handleClick = (entry: HistoryEntry) => {
    onNavigate(entry.url)
    onClose()
  }

  const handleClearAll = () => {
    clearHistory()
  }

  if (!isOpen) return <></>

  const dateGroups: DateGroup[] = ['Today', 'Yesterday', 'Older']

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-ink/60 fade-in" onClick={onClose}>
      <div
        className="w-[580px] max-h-[70vh] bg-panel rounded-xl border border-line shadow-lift overflow-hidden flex flex-col fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-line flex-shrink-0">
          <Clock size={16} className="text-accent flex-shrink-0" />
          <span className="text-sm font-medium text-cream">History</span>
          <span className="text-xs text-muted font-mono ml-1">{(history || []).length} entries</span>
          <button
            onClick={handleClearAll}
            className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-muted
                       hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Clear all history"
          >
            <Trash2 size={12} />
            Clear
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted hover:text-cream hover:bg-panel-3 transition-colors"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-4 py-2.5 border-b border-line flex-shrink-0">
          <div className="flex items-center gap-2 h-8 bg-ink rounded-lg border border-line px-2.5
                          focus-within:border-accent/60 transition-all">
            <Search size={13} className="text-muted flex-shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search history…"
              className="flex-1 bg-transparent text-sm text-cream placeholder-muted/60 outline-none font-mono"
              autoFocus
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-muted hover:text-cream transition-colors"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-1.5">
          {filteredHistory.length === 0 && (
            <div className="px-4 py-12 text-center text-muted text-sm font-mono">
              {searchQuery ? 'no matching history' : 'no browsing history yet'}
            </div>
          )}

          {dateGroups.map((group) => {
            const entries = groupedHistory[group]
            if (entries.length === 0) return null

            return (
              <div key={group}>
                <div className="px-4 pt-3 pb-1.5">
                  <span className="term-label">{group}</span>
                </div>
                {entries.map((entry) => (
                  <button
                    key={entry.id}
                    className="w-full text-left px-4 py-2 flex items-center gap-3 hover:bg-panel-2 transition-colors group"
                    onClick={() => handleClick(entry)}
                  >
                    {entry.favicon ? (
                      <img
                        src={entry.favicon}
                        alt=""
                        className="w-4 h-4 flex-shrink-0 rounded-sm"
                        onError={(e) => {
                          ;(e.target as HTMLImageElement).style.display = 'none'
                        }}
                      />
                    ) : (
                      <span className="w-4 h-4 flex-shrink-0 rounded-sm bg-panel-3 flex items-center justify-center text-[9px] font-mono text-muted">
                        {(entry.title || 'W').charAt(0).toUpperCase()}
                      </span>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-cream/85 truncate">{entry.title || 'Untitled'}</div>
                      <div className="text-[11px] text-muted truncate font-mono">{entry.url}</div>
                    </div>
                    <span className="text-[10px] text-muted/60 font-mono flex-shrink-0">
                      {formatTime(entry.timestamp)}
                    </span>
                    <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <a
                        href={entry.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="p-1 rounded text-muted hover:text-cream hover:bg-panel-3 transition-colors"
                        title="Open in new tab"
                      >
                        <ExternalLink size={12} />
                      </a>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          removeHistoryEntry(entry.id)
                        }}
                        className="p-1 rounded text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Remove"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </button>
                ))}
              </div>
            )
          })}
        </div>

        <div className="px-4 py-2.5 border-t border-line flex items-center gap-4 text-[11px] text-muted font-mono flex-shrink-0">
          <span>click to visit</span>
          <span>hover to delete</span>
          <span className="ml-auto">{filteredHistory.length} shown</span>
        </div>
      </div>
    </div>
  )
}
