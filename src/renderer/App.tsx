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

  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const setTabs = useTabStore((s) => s.setTabs)
  const setTask = useAgentStore((s) => s.setTask)
  const addAction = useAgentStore((s) => s.addAction)
  const setApprovalRequest = useAgentStore((s) => s.setApprovalRequest)
  const loadSettings = useSettingsStore((s) => s.loadSettings)
  const loadKeyStatus = useSettingsStore((s) => s.loadKeyStatus)
  const addHistoryEntry = useHistoryStore((s) => s.addHistoryEntry)
  const loadHistory = useHistoryStore((s) => s.loadHistory)
  const loadBookmarks = useHistoryStore((s) => s.loadBookmarks)

  const activeTab = tabs.find((t) => t.id === activeTabId) || null
  const prevUrlRef = useRef<string | null>(null)

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
    window.api.layout.setInsets(assistantOpen ? ASSISTANT_PANEL_WIDTH : 0)
  }, [assistantOpen])

  // Record history entries when the active tab navigates to a new URL
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
    loadSettings()
    loadKeyStatus()
    loadHistory()
    loadBookmarks()

    const unsubTabs = window.api.tabs.onUpdate((t, activeId) => setTabs(t, activeId))
    const unsubAgentStatus = window.api.agent.onStatus((task) => setTask(task))
    const unsubAgentAction = window.api.agent.onActionLog((action) => addAction(action))
    const unsubApproval = window.api.agent.onRequestApproval((description) => {
      setApprovalRequest(description)
      setAssistantMode('agent')
      setAssistantOpen(true)
    })
    const unsubCommandPalette = window.api.commandPalette.onToggle(() => {
      setShowCommandPalette((prev) => !prev)
    })

    return () => {
      unsubTabs()
      unsubAgentStatus()
      unsubAgentAction()
      unsubApproval()
      unsubCommandPalette()
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'b') {
        e.preventDefault()
        toggleAssistant('chat')
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'A') {
        e.preventDefault()
        toggleAssistant('agent')
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'f') {
        e.preventDefault()
        setShowFindInPage(true)
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'h') {
        e.preventDefault()
        setShowHistory((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [assistantOpen, assistantMode])

  return (
    <ErrorBoundary>
      <div className="flex flex-col h-screen bg-ink text-cream select-none font-body">
        <div className="flex items-center h-10 bg-ink app-drag">
          <TabBar />
        </div>

        <AddressBar
          assistantOpen={assistantOpen}
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
