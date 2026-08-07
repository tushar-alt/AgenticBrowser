import { create } from 'zustand'
import { TabInfo } from '@shared/types'

interface TabStore {
  tabs: TabInfo[]
  activeTabId: string | null
  setTabs: (tabs: TabInfo[], activeId: string | null) => void
  getActiveTab: () => TabInfo | null
  createTab: (url?: string) => Promise<void>
  closeTab: (tabId: string) => Promise<void>
  switchTab: (tabId: string) => Promise<void>
  navigateTab: (tabId: string, url: string) => Promise<void>
  reloadTab: (tabId: string) => Promise<void>
  goBack: (tabId: string) => Promise<void>
  goForward: (tabId: string) => Promise<void>
  stopTab: (tabId: string) => Promise<void>
  moveTab: (fromIndex: number, toIndex: number) => Promise<void>
}

export const useTabStore = create<TabStore>((set, get) => ({
  tabs: [],
  activeTabId: null,

  setTabs: (tabs, activeId) => set({ tabs, activeTabId: activeId }),

  getActiveTab: () => {
    const { tabs, activeTabId } = get()
    return tabs.find((t) => t.id === activeTabId) || null
  },

  createTab: async (url?: string) => {
    await window.api.tabs.create(url)
  },

  closeTab: async (tabId: string) => {
    await window.api.tabs.close(tabId)
  },

  switchTab: async (tabId: string) => {
    await window.api.tabs.switch(tabId)
  },

  navigateTab: async (tabId: string, url: string) => {
    await window.api.tabs.navigate(tabId, url)
  },

  reloadTab: async (tabId: string) => {
    await window.api.tabs.reload(tabId)
  },

  goBack: async (tabId: string) => {
    await window.api.tabs.back(tabId)
  },

  goForward: async (tabId: string) => {
    await window.api.tabs.forward(tabId)
  },

  stopTab: async (tabId: string) => {
    await window.api.tabs.stop(tabId)
  },

  moveTab: async (fromIndex: number, toIndex: number) => {
    await window.api.tabs.moved(fromIndex, toIndex)
  }
}))
