import React, { useState, useEffect, useRef } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, X, Lock, Sparkles, Settings, Star } from 'lucide-react'
import { useTabStore } from '../../store/tabStore'
import { useSettingsStore } from '../../store/settingsStore'
import { useHistoryStore } from '../../store/historyStore'

interface AddressBarProps {
  assistantOpen: boolean
  onToggleAssistant: () => void
}

export function AddressBar({ assistantOpen, onToggleAssistant }: AddressBarProps): React.JSX.Element {
  const { tabs, activeTabId, navigateTab, reloadTab, goBack, goForward, stopTab } = useTabStore()
  const { isBookmarked, addBookmark, removeBookmark, getBookmarkByUrl, loadBookmarks } = useHistoryStore()
  const [inputValue, setInputValue] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const activeTab = tabs.find((t) => t.id === activeTabId)

  useEffect(() => {
    loadBookmarks()
  }, [])

  useEffect(() => {
    if (!isEditing) {
      setInputValue(activeTab && !activeTab.isNewTab && activeTab.url !== 'about:blank' ? activeTab.url : '')
    }
  }, [activeTab?.url, activeTab?.isNewTab, isEditing])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 't') {
        e.preventDefault()
        useTabStore.getState().createTab()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
        e.preventDefault()
        if (activeTabId) useTabStore.getState().closeTab(activeTabId)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeTabId])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeTabId || !inputValue.trim()) return
    navigateTab(activeTabId, inputValue.trim())
    setIsEditing(false)
    inputRef.current?.blur()
  }

  const handleBookmarkToggle = () => {
    if (!activeTab || activeTab.isNewTab || activeTab.url === 'about:blank') return

    const url = activeTab.url
    const existing = getBookmarkByUrl(url)

    if (existing) {
      removeBookmark(existing.id)
    } else {
      addBookmark({
        url: activeTab.url,
        title: activeTab.title || 'Untitled',
        favicon: activeTab.favicon || '',
        folder: 'Unsorted'
      })
    }
  }

  const isLoading = activeTab?.isLoading ?? false
  const isSecure = activeTab?.url.startsWith('https://')
  const currentUrl = activeTab?.url || ''
  const bookmarked = currentUrl && currentUrl !== 'about:blank' ? isBookmarked(currentUrl) : false

  const navBtn =
    'w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:text-cream hover:bg-panel-3 ' +
    'disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-muted transition-colors'

  return (
    <div className="flex items-center h-12 px-2 bg-panel border-b border-line gap-1 no-drag flex-shrink-0">
      <button onClick={() => activeTabId && goBack(activeTabId)} disabled={!activeTab?.canGoBack} className={navBtn} title="Back">
        <ArrowLeft size={16} />
      </button>
      <button onClick={() => activeTabId && goForward(activeTabId)} disabled={!activeTab?.canGoForward} className={navBtn} title="Forward">
        <ArrowRight size={16} />
      </button>
      <button
        onClick={() => {
          if (activeTabId) {
            if (isLoading) stopTab(activeTabId)
            else reloadTab(activeTabId)
          }
        }}
        className={navBtn}
        title={isLoading ? 'Stop' : 'Reload'}
      >
        {isLoading ? <X size={16} /> : <RotateCw size={15} />}
      </button>

      <form onSubmit={handleSubmit} className="flex-1 mx-2">
        <div
          className="flex items-center h-9 bg-ink rounded-lg border border-line px-3 gap-2
                     focus-within:border-accent/60 focus-within:shadow-glow transition-all"
        >
          {isSecure ? (
            <Lock size={13} className="text-agent-running flex-shrink-0" />
          ) : (
            <span className="w-[13px] flex-shrink-0" />
          )}
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onFocus={() => {
              setIsEditing(true)
              setTimeout(() => inputRef.current?.select(), 0)
            }}
            onBlur={() => setIsEditing(false)}
            placeholder="Search the web or type a URL…"
            className="flex-1 bg-transparent text-sm text-cream placeholder-muted/60 outline-none min-w-0 font-mono"
          />
        </div>
      </form>

      <button
        onClick={handleBookmarkToggle}
        className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
          bookmarked
            ? 'text-accent hover:text-accent-hover'
            : 'text-muted hover:text-cream hover:bg-panel-3'
        }`}
        title={bookmarked ? 'Remove bookmark' : 'Bookmark this page'}
      >
        <Star size={16} fill={bookmarked ? 'currentColor' : 'none'} />
      </button>

      <button
        onClick={onToggleAssistant}
        className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-sm font-medium transition-all ${
          assistantOpen
            ? 'bg-accent text-ink shadow-glow'
            : 'text-muted hover:text-cream hover:bg-panel-3'
        }`}
        title="Toggle Assistant (Ctrl+B)"
      >
        <Sparkles size={15} />
        <span className="hidden lg:inline">Assistant</span>
      </button>

      <button
        onClick={() => useSettingsStore.getState().openSettings()}
        className={navBtn}
        title="Settings"
      >
        <Settings size={16} />
      </button>
    </div>
  )
}
