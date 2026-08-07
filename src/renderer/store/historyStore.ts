import { create } from 'zustand'
import { HistoryEntry, Bookmark } from '@shared/types'

interface HistoryStore {
  history: HistoryEntry[]
  bookmarks: Bookmark[]

  loadHistory: () => Promise<void>
  addHistoryEntry: (entry: Omit<HistoryEntry, 'id' | 'timestamp'>) => Promise<void>
  removeHistoryEntry: (id: string) => Promise<void>
  clearHistory: () => Promise<void>

  loadBookmarks: () => Promise<void>
  addBookmark: (bookmark: Omit<Bookmark, 'id' | 'timestamp'>) => Promise<void>
  removeBookmark: (id: string) => Promise<void>
  isBookmarked: (url: string) => boolean
  getBookmarkByUrl: (url: string) => Bookmark | undefined
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

const HISTORY_STORAGE_KEY = 'agentic-history'
const BOOKMARKS_STORAGE_KEY = 'agentic-bookmarks'

function loadFromStorage<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveToStorage<T>(key: string, data: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch {
    // Storage full or unavailable
  }
}

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  history: [],
  bookmarks: [],

  loadHistory: async () => {
    try {
      const entries = await window.api.history.get()
      set({ history: entries })
    } catch {
      // Fallback to localStorage
      const entries = loadFromStorage<HistoryEntry>(HISTORY_STORAGE_KEY)
      set({ history: entries })
    }
  },

  addHistoryEntry: async (entry) => {
    const newEntry: HistoryEntry = {
      ...entry,
      id: generateId(),
      timestamp: Date.now()
    }

    set((state) => {
      // Deduplicate by url — remove existing entry for same url
      const filtered = state.history.filter((h) => h.url !== entry.url)
      const history = [newEntry, ...filtered].slice(0, 5000) // Cap at 5000 entries
      saveToStorage(HISTORY_STORAGE_KEY, history)
      return { history }
    })

    try {
      await window.api.history.add(newEntry)
    } catch {
      // IPC not available, localStorage already saved
    }
  },

  removeHistoryEntry: async (id) => {
    set((state) => {
      const history = state.history.filter((h) => h.id !== id)
      saveToStorage(HISTORY_STORAGE_KEY, history)
      return { history }
    })

    try {
      await window.api.history.remove(id)
    } catch {
      // IPC not available
    }
  },

  clearHistory: async () => {
    set({ history: [] })
    saveToStorage(HISTORY_STORAGE_KEY, [])

    try {
      await window.api.history.clear()
    } catch {
      // IPC not available
    }
  },

  loadBookmarks: async () => {
    try {
      const entries = await window.api.bookmarks.get()
      set({ bookmarks: entries })
    } catch {
      // Fallback to localStorage
      const entries = loadFromStorage<Bookmark>(BOOKMARKS_STORAGE_KEY)
      set({ bookmarks: entries })
    }
  },

  addBookmark: async (bookmark) => {
    const newBookmark: Bookmark = {
      ...bookmark,
      id: generateId(),
      timestamp: Date.now()
    }

    set((state) => {
      const bookmarks = [...state.bookmarks, newBookmark]
      saveToStorage(BOOKMARKS_STORAGE_KEY, bookmarks)
      return { bookmarks }
    })

    try {
      await window.api.bookmarks.add(newBookmark)
    } catch {
      // IPC not available
    }
  },

  removeBookmark: async (id) => {
    set((state) => {
      const bookmarks = state.bookmarks.filter((b) => b.id !== id)
      saveToStorage(BOOKMARKS_STORAGE_KEY, bookmarks)
      return { bookmarks }
    })

    try {
      await window.api.bookmarks.remove(id)
    } catch {
      // IPC not available
    }
  },

  isBookmarked: (url) => {
    return get().bookmarks.some((b) => b.url === url)
  },

  getBookmarkByUrl: (url) => {
    return get().bookmarks.find((b) => b.url === url)
  }
}))
