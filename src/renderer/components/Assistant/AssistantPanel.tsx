import React from 'react'
import { MessageSquare, Bot, X } from 'lucide-react'
import { ChatPanel } from '../ChatPanel/ChatPanel'
import { Supervisor } from '../Supervisor/Supervisor'
import { ASSISTANT_PANEL_WIDTH } from '@shared/constants'

export type AssistantMode = 'chat' | 'agent'

interface AssistantPanelProps {
  mode: AssistantMode
  onModeChange: (mode: AssistantMode) => void
  onClose: () => void
}

export function AssistantPanel({ mode, onModeChange, onClose }: AssistantPanelProps): React.JSX.Element {
  const modeButton = (m: AssistantMode, label: string, Icon: React.ComponentType<{ size?: number }>) => (
    <button
      onClick={() => onModeChange(m)}
      className={`flex items-center gap-1.5 px-3 h-7 rounded-md text-xs font-medium transition-all ${
        mode === m ? 'bg-accent text-ink' : 'text-muted hover:text-cream'
      }`}
    >
      <Icon size={13} />
      {label}
    </button>
  )

  return (
    <div
      className="flex flex-col h-full bg-panel border-l border-line slide-in flex-shrink-0"
      style={{ width: ASSISTANT_PANEL_WIDTH }}
    >
      <div className="flex items-center gap-2 px-3 h-12 border-b border-line flex-shrink-0">
        <div className="flex items-center gap-0.5 bg-panel-2 rounded-lg p-0.5">
          {modeButton('chat', 'Chat', MessageSquare)}
          {modeButton('agent', 'Agent', Bot)}
        </div>
        <button
          onClick={onClose}
          className="ml-auto p-1.5 rounded-md text-muted hover:text-cream hover:bg-panel-3 transition-colors"
          title="Close panel"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        {mode === 'chat' ? <ChatPanel /> : <Supervisor />}
      </div>
    </div>
  )
}
