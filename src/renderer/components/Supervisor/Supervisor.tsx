import React, { useEffect, useState } from 'react'
import { Pause, Play, Square, Check, X, ChevronRight } from 'lucide-react'
import { useAgentStore } from '../../store/agentStore'

export function Supervisor(): React.JSX.Element {
  const {
    task, isRunning, isPaused, actions, approvalRequest,
    startAgent, stopAgent, pauseAgent, resumeAgent, approveAction, denyAction
  } = useAgentStore()
  const [goalInput, setGoalInput] = useState('')

  // Live elapsed timer while a task is in flight.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!isRunning && task?.status !== 'planning') return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [isRunning, task?.status])

  const elapsed = task?.startTime ? Math.max(0, Math.floor((now - task.startTime) / 1000)) : 0
  const elapsedLabel = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`

  // The single action currently executing (the store keeps one running row).
  const runningAction = [...actions].reverse().find((a) => a.status === 'running') || null
  const nowDoing =
    task?.status === 'planning'
      ? null // rendered by the dedicated planning card
      : runningAction
        ? runningAction.description
        : task && task.plan.length > 0 && task.currentStep < task.plan.length
          ? task.plan[task.currentStep]
          : null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (goalInput.trim() && !isRunning) {
      startAgent(goalInput.trim())
      setGoalInput('')
    }
  }

  const progress = task
    ? task.plan.length > 0
      ? Math.round((task.currentStep / task.plan.length) * 100)
      : 0
    : 0

  const statusMeta: Record<string, { color: string; label: string }> = {
    idle: { color: 'text-muted', label: 'IDLE' },
    planning: { color: 'text-yellow-400', label: 'PLANNING' },
    running: { color: 'text-agent-running', label: 'RUNNING' },
    paused: { color: 'text-agent-paused', label: 'PAUSED' },
    completed: { color: 'text-agent-running', label: 'COMPLETED' },
    stopped: { color: 'text-orange-400', label: 'STOPPED' },
    failed: { color: 'text-agent-stopped', label: 'FAILED' }
  }
  const status = statusMeta[task?.status || 'idle']

  const controlBtn =
    'flex items-center gap-1 px-2 py-1 text-[11px] rounded-md transition-colors'

  return (
    <>
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-line flex-shrink-0">
        {task && (
          <span className={`flex items-center gap-1.5 text-[10px] font-mono tracking-terminal ${status.color}`}>
            <span className={`w-1.5 h-1.5 rounded-full bg-current ${task?.status === 'running' ? 'live-dot' : ''}`} />
            {status.label}
          </span>
        )}
        {task && (isRunning || task.status === 'planning') && (
          <span className="text-[10px] font-mono text-muted tabular-nums">{elapsedLabel}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {isRunning && !isPaused && (
            <button onClick={pauseAgent} className={`${controlBtn} bg-yellow-500/15 text-yellow-400 hover:bg-yellow-500/25`}>
              <Pause size={11} /> Pause
            </button>
          )}
          {isPaused && (
            <button onClick={resumeAgent} className={`${controlBtn} bg-agent-running/15 text-agent-running hover:bg-agent-running/25`}>
              <Play size={11} /> Resume
            </button>
          )}
          {isRunning && (
            <button onClick={stopAgent} className={`${controlBtn} bg-red-500/15 text-red-400 hover:bg-red-500/25`}>
              <Square size={11} /> Stop
            </button>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="px-3 py-3 border-b border-line flex-shrink-0">
        <div className="flex items-center gap-2 bg-panel-2 border border-line rounded-xl px-3 py-2 focus-within:border-accent/60 transition-colors">
          <span className="font-mono text-accent text-sm">▶</span>
          <input
            type="text"
            value={goalInput}
            onChange={(e) => setGoalInput(e.target.value)}
            placeholder="Describe a task for the agent…"
            disabled={isRunning}
            className="flex-1 bg-transparent outline-none text-sm text-cream placeholder-muted/60 disabled:opacity-50 font-mono"
          />
          <button
            type="submit"
            disabled={isRunning || !goalInput.trim()}
            className="px-3 h-7 rounded-lg bg-accent text-ink text-xs font-semibold
                       hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Run
          </button>
        </div>
      </form>

      <div className="flex-1 overflow-y-auto">
        {task && task.status !== 'failed' && nowDoing && (
          <div className="mx-3 mt-3 p-3 rounded-xl bg-panel-2 border border-accent/30 fade-up">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-accent live-dot" />
              <span className="term-label text-accent">now</span>
              <span className="ml-auto text-[10px] font-mono text-muted tabular-nums">{elapsedLabel}</span>
            </div>
            <p className="text-sm text-cream leading-snug">{nowDoing}</p>
          </div>
        )}

        {task?.status === 'planning' && (
          <div className="mx-3 mt-3 p-3 rounded-xl bg-panel-2 border border-line fade-up">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 live-dot" />
              <span className="term-label text-yellow-400">planning</span>
            </div>
            <p className="text-sm text-cream/90 mt-1.5 font-mono">
              thinking through the steps<span className="cursor-blink">…</span>
            </p>
          </div>
        )}

        {task?.error && (
          <div className="mx-3 mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/30 fade-up">
            <div className="term-label text-red-400 mb-1.5">⚠ task failed</div>
            <p className="text-xs text-red-300/90 font-mono break-words whitespace-pre-wrap">{task.error}</p>
            <p className="text-[11px] text-muted mt-2">Check the provider &amp; model in Settings, then try again.</p>
          </div>
        )}

        {task?.status === 'stopped' && !task?.error && (
          <div className="mx-3 mt-3 p-3 rounded-xl bg-orange-500/10 border border-orange-500/30 fade-up">
            <div className="term-label text-orange-400 mb-1.5">■ task stopped</div>
            <p className="text-xs text-orange-300/90 font-mono">Task was stopped by user after {task.actions.length} actions.</p>
          </div>
        )}

        {approvalRequest && (
          <div className="mx-3 my-3 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl fade-up">
            <div className="text-[10px] font-mono tracking-terminal text-yellow-400 mb-1.5">⚠ APPROVAL REQUIRED</div>
            <div className="text-sm text-cream mb-3">{approvalRequest}</div>
            <div className="flex gap-2">
              <button
                onClick={approveAction}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-agent-running/15 text-agent-running
                           text-sm rounded-lg hover:bg-agent-running/25 transition-colors"
              >
                <Check size={14} /> Approve
              </button>
              <button
                onClick={denyAction}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-red-500/15 text-red-400
                           text-sm rounded-lg hover:bg-red-500/25 transition-colors"
              >
                <X size={14} /> Deny
              </button>
            </div>
          </div>
        )}

        {task && task.plan.length > 0 && (
          <div className="px-3 py-3 border-b border-line">
            <div className="flex items-center justify-between mb-2">
              <span className="term-label">PLAN</span>
              <span className="text-[11px] font-mono text-muted">{progress}%</span>
            </div>
            <div className="w-full h-1 bg-panel-3 rounded-full overflow-hidden mb-3">
              <div className="h-full bg-accent transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
            <div className="space-y-1">
              {task.plan.map((step, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-2 text-xs py-0.5 ${
                    i < task.currentStep
                      ? 'text-agent-running'
                      : i === task.currentStep
                        ? 'text-cream'
                        : 'text-muted/60'
                  }`}
                >
                  <span className="mt-0.5 flex-shrink-0">
                    {i < task.currentStep ? '✓' : i === task.currentStep ? <ChevronRight size={12} className="inline text-accent" /> : '·'}
                  </span>
                  <span className={i === task.currentStep ? 'font-medium' : ''}>{step}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="px-3 py-3">
          <div className="term-label mb-2">ACTIVITY</div>
          {actions.length === 0 && (
            <div className="text-xs text-muted/60 font-mono italic">no agent activity yet</div>
          )}
          <div className="space-y-2">
            {actions.map((action) => (
              <div key={action.id} className="flex items-start gap-2 text-xs">
                <span
                  className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    action.status === 'completed'
                      ? 'bg-agent-running'
                      : action.status === 'running'
                        ? 'bg-yellow-400 live-dot'
                        : action.status === 'failed'
                          ? 'bg-agent-stopped'
                          : 'bg-muted/40'
                  }`}
                />
                <div className="min-w-0">
                  <div className="text-cream/90 leading-snug">{action.description}</div>
                  {action.result && action.status === 'failed' && (
                    <div className="text-red-400/70 mt-0.5 font-mono text-[11px]">{action.result}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
