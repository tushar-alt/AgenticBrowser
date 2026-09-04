import React, { useEffect, useState, useRef } from 'react'
import { useTabStore } from './store/tabStore'
import { useAgentStore } from './store/agentStore'
import { useSettingsStore } from './store/settingsStore'
import { useHistoryStore } from './store/historyStore'
import { TabBar } from './components/TabBar/TabBar'
import { AddressBar } from './components/AddressBar/AddressBar'
import { AssistantPanel, AssistantMode } from './components/Assistant/AssistantPanel'
import { NewTab } from './components/NewTab/NewTab'
import { CommandPalette } from './components/CommandPalette/CommandPalette'
import { SettingsPanel } from './components/Settings/SettingsPanel'
import { FindInPage } from './components/FindInPage/FindInPage'
import { HistoryPanel } from './components/History/HistoryPanel'
import { BookmarksPanel } from './components/Bookmarks/BookmarksPanel'
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary'
import { ASSISTANT_PANEL_WIDTH } from '@shared/constants'

export default function App(): React.JSX.Element {
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistantMode, setAssistantMode] = useState<AssistantMode>('chat')
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [showFindInPage, setShowFindInPage] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showBookmarks, setShowBookmarks] = useState(false)
  const [addressFocusSignal, setAddressFocusSignal] = useState(0)

  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const setTabs = useTabStore((s) => s.setTabs)
  const setTask = useAgentStore((s) => s.setTask)
  const addAction = useAgentStore((s) => s.addAction)
  const setApprovalRequest = useAgentStore((s) => s.setApprovalRequest)
  const setDebugLog = useAgentStore((s) => s.setDebugLog)
  const loadSettings = useSettingsStore((s) => s.loadSettings)
  const loadKeyStatus = useSettingsStore((s) => s.loadKeyStatus)
  const addHistoryEntry = useHistoryStore((s) => s.addHistoryEntry)
  const loadHistory = useHistoryStore((s) => s.loadHistory)
  const loadBookmarks = useHistoryStore((s) => s.loadBookmarks)

  const activeTab = tabs.find((t) => t.id === activeTabId) || null
  const prevUrlRef = useRef<string | null>(null)
  const settingsOpen = useSettingsStore((s) => s.isOpen)

  // Modal overlays drawn by the chrome are invisible under the native page
  // view, so the page steps aside while one is open. Find-in-page stays
  // exempt: its match highlights live in the page itself.
  useEffect(() => {
    const overlayOpen = showCommandPalette || showHistory || showBookmarks || settingsOpen
    window.api?.layout?.setOverlay(overlayOpen).catch(() => {})
  }, [showCommandPalette, showHistory, showBookmarks, settingsOpen])

  const openAssistant = (mode: AssistantMode): void => {
    setAssistantMode(mode)
    setAssistantOpen(true)
  }

  const toggleAssistant = (mode: AssistantMode): void => {
    if (assistantOpen && assistantMode === mode) {
      setAssistantOpen(false)
    } else {
      openAssistant(mode)
    }
  }

  const handleNavigate = (url: string): void => {
    if (activeTabId) {
      useTabStore.getState().navigateTab(activeTabId, url)
    }
  }

  // Keep the native tab view from sliding under the Assistant panel.
  useEffect(() => {
    window.api?.layout?.setInsets(assistantOpen ? ASSISTANT_PANEL_WIDTH : 0)
  }, [assistantOpen])  // Record history entries when the active tab navigates to a new URL
  useEffect(() => {
    if (activeTab && !activeTab.isNewTab && activeTab.url && activeTab.url !== 'about:blank') {
      if (activeTab.url !== prevUrlRef.current) {
        prevUrlRef.current = activeTab.url
        addHistoryEntry({
          url: activeTab.url,
          title: activeTab.title || 'Untitled',
          favicon: activeTab.favicon || ''
        })
      }
    }
  }, [activeTab?.url, activeTab?.title])

  useEffect(() => {
    if (!window.api) return

    loadSettings()
    loadKeyStatus()
    loadHistory()
    loadBookmarks()

    const unsubTabs = window.api.tabs?.onUpdate((t, activeId) => setTabs(t, activeId))
    const unsubAgentStatus = window.api.agent?.onStatus((task) => setTask(task))
    const unsubAgentAction = window.api.agent?.onActionLog((action) => addAction(action))
    const unsubApproval = window.api.agent?.onRequestApproval((description) => {
      setApprovalRequest(description)
      setAssistantMode('agent')
      setAssistantOpen(true)
    })
    const unsubDebugLog = window.api.agent?.onDebugLog((log) => {
      setDebugLog(log)
    })
    const unsubCommandPalette = window.api.commandPalette?.onToggle(() => {
      setShowCommandPalette((prev) => !prev)
    })

    return () => {
      unsubTabs?.()
      unsubAgentStatus?.()
      unsubAgentAction?.()
      unsubApproval?.()
      unsubDebugLog?.()
      unsubCommandPalette?.()
    }
  }, [])

  // One place that maps shortcut combos to UI actions. Used both by the
  // renderer keydown listener (chrome focused) and by forwarded events from
  // the main process (web page focused — the page owns the keyboard there).
  const runShortcut = (combo: string): void => {
    switch (combo) {
      case 'mod+k':
        setShowCommandPalette((prev) => !prev)
        break
      case 'mod+b':
        toggleAssistant('chat')
        break
      case 'mod+shift+a':
        toggleAssistant('agent')
        break
      case 'mod+f':
        setShowFindInPage(true)
        break
      case 'mod+h':
        setShowHistory((prev) => !prev)
        break
      case 'mod+l':
        setShowCommandPalette(false)
        setAddressFocusSignal((n) => n + 1)
        break
    }
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase()
        if (key === 'k' || key === 'b' || key === 'f' || key === 'h') {
          e.preventDefault()
          runShortcut(e.shiftKey ? `mod+shift+${key}` : `mod+${key}`)
          return
        }
        if (e.shiftKey && key === 'a') {
          e.preventDefault()
          runShortcut('mod+shift+a')
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [assistantOpen, assistantMode])

  // Shortcuts forwarded from the main process while a web page has focus.
  useEffect(() => {
    if (!window.api?.ui) return
    return window.api.ui.onShortcut((combo) => runShortcut(combo))
  }, [assistantOpen, assistantMode])

  return (
    <ErrorBoundary>
      <div className="flex flex-col h-screen bg-ink text-cream select-none font-body">
        <div className="flex items-center h-10 bg-ink app-drag">
          <TabBar />
        </div>

        <AddressBar
          assistantOpen={assistantOpen}
          focusSignal={addressFocusSignal}
          onToggleAssistant={() => toggleAssistant(assistantMode)}
        />

        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 relative overflow-hidden">
            <ErrorBoundary>
              {activeTab?.isNewTab && <NewTab onOpenAssistant={openAssistant} />}
            </ErrorBoundary>
            <FindInPage isOpen={showFindInPage} onClose={() => setShowFindInPage(false)} />
          </div>

          {assistantOpen && (
            <ErrorBoundary>
              <AssistantPanel
                mode={assistantMode}
                onModeChange={setAssistantMode}
                onClose={() => setAssistantOpen(false)}
              />
            </ErrorBoundary>
          )}
        </div>

        <CommandPalette
          isOpen={showCommandPalette}
          onClose={() => setShowCommandPalette(false)}
          onToggleChat={() => toggleAssistant('chat')}
          onToggleSupervisor={() => toggleAssistant('agent')}
          onShowHistory={() => setShowHistory(true)}
          onShowBookmarks={() => setShowBookmarks(true)}
        />

        <HistoryPanel
          isOpen={showHistory}
          onClose={() => setShowHistory(false)}
          onNavigate={handleNavigate}
        />

        <BookmarksPanel
          isOpen={showBookmarks}
          onClose={() => setShowBookmarks(false)}
          onNavigate={handleNavigate}
        />

        <SettingsPanel />
      </div>
    </ErrorBoundary>
  )
}
