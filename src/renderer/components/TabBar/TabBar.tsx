import React, { useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useTabStore } from '../../store/tabStore'

export function TabBar(): React.JSX.Element {
  const { tabs, activeTabId, switchTab, closeTab, createTab, moveTab } = useTabStore()
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const dragCounter = useRef(0)

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDragIndex(index)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIndex(index)
  }

  const handleDragLeave = () => {
    dragCounter.current--
    if (dragCounter.current === 0) setDragOverIndex(null)
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current++
  }

  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault()
    dragCounter.current = 0
    if (dragIndex !== null && dragIndex !== toIndex) {
      moveTab(dragIndex, toIndex)
    }
    setDragIndex(null)
    setDragOverIndex(null)
  }

  const handleDragEnd = () => {
    setDragIndex(null)
    setDragOverIndex(null)
    dragCounter.current = 0
  }

  const handleClose = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation()
    closeTab(tabId)
  }

  return (
    // pr-[138px] keeps tabs clear of the native window controls (titleBarOverlay) on Windows.
    <div className="flex items-center h-full flex-1 min-w-0 overflow-x-auto no-drag pl-2 pr-[138px] gap-1">
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTabId
        return (
          <div
            key={tab.id}
            className={`
              group relative flex items-center h-8 min-w-[150px] max-w-[220px] px-2.5 rounded-lg cursor-pointer
              transition-colors flex-shrink-0
              ${isActive ? 'bg-panel text-cream' : 'text-muted hover:bg-panel/50 hover:text-cream/80'}
              ${dragOverIndex === index ? 'ring-1 ring-accent' : ''}
              ${dragIndex === index ? 'opacity-40' : ''}
            `}
            onClick={() => switchTab(tab.id)}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, index)}
            onDragEnd={handleDragEnd}
          >
            {isActive && (
              <span className="absolute top-0 left-2.5 right-2.5 h-0.5 rounded-full bg-accent" />
            )}

            {tab.favicon ? (
              <img src={tab.favicon} alt="" className="w-3.5 h-3.5 mr-2 flex-shrink-0 rounded-sm" />
            ) : (
              <span
                className={`w-3.5 h-3.5 mr-2 flex-shrink-0 rounded-sm flex items-center justify-center text-[9px] font-mono font-bold ${
                  isActive ? 'bg-accent text-ink' : 'bg-panel-3 text-muted'
                }`}
              >
                {(tab.title || 'N').charAt(0).toUpperCase()}
              </span>
            )}

            <span className="truncate text-xs flex-1 mr-1">
              {tab.isLoading ? '… ' : ''}
              {tab.isNewTab ? 'New Tab' : tab.title || 'New Tab'}
            </span>

            <button
              onClick={(e) => handleClose(e, tab.id)}
              className="opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center
                         rounded hover:bg-red-500/20 hover:text-red-400 text-muted transition-all flex-shrink-0"
            >
              <X size={12} />
            </button>
          </div>
        )
      })}

      <button
        onClick={() => createTab()}
        className="w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:text-cream
                   hover:bg-panel/60 transition-colors flex-shrink-0"
        title="New Tab (Ctrl+T)"
      >
        <Plus size={15} />
      </button>
    </div>
  )
}
