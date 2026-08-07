import React, { useState, useEffect, useMemo } from 'react'
import { X, Search, FolderOpen, Folder, Star, ExternalLink } from 'lucide-react'
import { useHistoryStore } from '../../store/historyStore'
import { Bookmark as BookmarkEntry } from '@shared/types'

interface BookmarksPanelProps {
  isOpen: boolean
  onClose: () => void
  onNavigate: (url: string) => void
}

export function BookmarksPanel({ isOpen, onClose, onNavigate }: BookmarksPanelProps): React.JSX.Element {
  const { bookmarks, loadBookmarks, removeBookmark } = useHistoryStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      loadBookmarks()
    }
  }, [isOpen])

  const folders = useMemo(() => {
    const folderSet = new Set<string>()
    for (const b of bookmarks) {
      folderSet.add(b.folder || 'Unsorted')
    }
    return Array.from(folderSet).sort()
  }, [bookmarks])

  const filteredBookmarks = useMemo(() => {
    let filtered = bookmarks

    if (selectedFolder) {
      filtered = filtered.filter((b) => (b.folder || 'Unsorted') === selectedFolder)
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (b) => b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)
      )
    }

    return filtered
  }, [bookmarks, searchQuery, selectedFolder])

  const handleClick = (bookmark: BookmarkEntry) => {
    onNavigate(bookmark.url)
    onClose()
  }

  if (!isOpen) return <></>

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-ink/60 fade-in" onClick={onClose}>
      <div
        className="w-[580px] max-h-[70vh] bg-panel rounded-xl border border-line shadow-lift overflow-hidden flex flex-col fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-line flex-shrink-0">
          <Star size={16} className="text-accent flex-shrink-0" fill="currentColor" />
          <span className="text-sm font-medium text-cream">Bookmarks</span>
          <span className="text-xs text-muted font-mono ml-1">{bookmarks.length} saved</span>
          <button
            onClick={onClose}
            className="ml-auto p-1.5 rounded-md text-muted hover:text-cream hover:bg-panel-3 transition-colors"
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
              placeholder="Search bookmarks…"
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

        {folders.length > 0 && (
          <div className="px-4 py-2 border-b border-line flex items-center gap-1.5 overflow-x-auto flex-shrink-0">
            <button
              onClick={() => setSelectedFolder(null)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex-shrink-0 ${
                selectedFolder === null
                  ? 'bg-accent text-ink'
                  : 'text-muted hover:text-cream hover:bg-panel-3'
              }`}
            >
              All
            </button>
            {folders.map((folder) => (
              <button
                key={folder}
                onClick={() => setSelectedFolder(folder === selectedFolder ? null : folder)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex-shrink-0 ${
                  selectedFolder === folder
                    ? 'bg-accent text-ink'
                    : 'text-muted hover:text-cream hover:bg-panel-3'
                }`}
              >
                {selectedFolder === folder ? <FolderOpen size={11} /> : <Folder size={11} />}
                {folder}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto py-1.5">
          {filteredBookmarks.length === 0 && (
            <div className="px-4 py-12 text-center text-muted text-sm font-mono">
              {searchQuery ? 'no matching bookmarks' : 'no bookmarks yet'}
            </div>
          )}

          {filteredBookmarks.map((bookmark) => (
            <button
              key={bookmark.id}
              className="w-full text-left px-4 py-2 flex items-center gap-3 hover:bg-panel-2 transition-colors group"
              onClick={() => handleClick(bookmark)}
            >
              {bookmark.favicon ? (
                <img
                  src={bookmark.favicon}
                  alt=""
                  className="w-4 h-4 flex-shrink-0 rounded-sm"
                  onError={(e) => {
                    ;(e.target as HTMLImageElement).style.display = 'none'
                  }}
                />
              ) : (
                <span className="w-4 h-4 flex-shrink-0 rounded-sm bg-panel-3 flex items-center justify-center text-[9px] font-mono text-muted">
                  {(bookmark.title || 'W').charAt(0).toUpperCase()}
                </span>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm text-cream/85 truncate">{bookmark.title || 'Untitled'}</div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted truncate font-mono">{bookmark.url}</span>
                  {bookmark.folder && (
                    <span className="flex items-center gap-0.5 text-[10px] text-muted/60 font-mono flex-shrink-0">
                      <Folder size={9} />
                      {bookmark.folder}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <a
                  href={bookmark.url}
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
                    removeBookmark(bookmark.id)
                  }}
                  className="p-1 rounded text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  title="Remove bookmark"
                >
                  <X size={12} />
                </button>
              </div>
            </button>
          ))}
        </div>

        <div className="px-4 py-2.5 border-t border-line flex items-center gap-4 text-[11px] text-muted font-mono flex-shrink-0">
          <span>click to visit</span>
          <span>hover to manage</span>
          <span className="ml-auto">{filteredBookmarks.length} shown</span>
        </div>
      </div>
    </div>
  )
}
