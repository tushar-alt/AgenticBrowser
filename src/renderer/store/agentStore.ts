import { create } from 'zustand'
import { AgentTask, AgentAction } from '@shared/types'

interface AgentStore {
  task: AgentTask | null
  isRunning: boolean
  isPaused: boolean
  actions: AgentAction[]
  approvalRequest: string | null

  setTask: (task: AgentTask) => void
  addAction: (action: AgentAction) => void
  setApprovalRequest: (description: string | null) => void
  clearApprovalRequest: () => void

  startAgent: (goal: string) => Promise<void>
  stopAgent: () => Promise<void>
  pauseAgent: () => Promise<void>
  resumeAgent: () => Promise<void>
  approveAction: () => Promise<void>
  denyAction: () => Promise<void>
}

export const useAgentStore = create<AgentStore>((set) => ({
  task: null,
  isRunning: false,
  isPaused: false,
  actions: [],
  approvalRequest: null,

  setTask: (task) =>
    set({
      task,
      isRunning: task.status === 'running' || task.status === 'planning',
      isPaused: task.status === 'paused'
    }),

  addAction: (action) =>
    set((state) => {
      // Upsert by id: the orchestrator emits the same action twice
      // (running -> completed/failed), so update the existing row in place
      // instead of duplicating it. This lets the live status dot transition.
      const idx = state.actions.findIndex((a) => a.id === action.id)
      if (idx >= 0) {
        const next = state.actions.slice()
        next[idx] = action
        return { actions: next }
      }
      return { actions: [...state.actions, action] }
    }),

  setApprovalRequest: (description) => set({ approvalRequest: description }),
  clearApprovalRequest: () => set({ approvalRequest: null }),

  startAgent: async (goal: string) => {
    set({ actions: [], task: null, approvalRequest: null })
    try {
      await window.api.agent.start(goal)
    } catch (error) {
      console.error('Failed to start agent:', error)
    }
  },

  stopAgent: async () => {
    await window.api.agent.stop()
    set({ isRunning: false, isPaused: false })
  },

  pauseAgent: async () => {
    await window.api.agent.pause()
    set({ isPaused: true })
  },

  resumeAgent: async () => {
    await window.api.agent.resume()
    set({ isPaused: false })
  },

  approveAction: async () => {
    await window.api.agent.approve()
    set({ approvalRequest: null })
  },

  denyAction: async () => {
    await window.api.agent.deny()
    set({ approvalRequest: null })
  }
}))
