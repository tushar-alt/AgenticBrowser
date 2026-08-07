import React, { useState, useEffect } from 'react'
import { X, Plug, Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { useSettingsStore } from '../../store/settingsStore'
import { AIProvider } from '@shared/types'
import { DEFAULT_AI_MODELS, PROVIDER_BASE_URLS } from '@shared/constants'

export function SettingsPanel(): React.JSX.Element {
  const {
    settings, isOpen, keyStatus, testResult,
    closeSettings, updateSettings, testConnection, loadKeyStatus
  } = useSettingsStore()

  const [provider, setProvider] = useState<AIProvider>(settings.aiProvider)
  const [apiKey, setApiKey] = useState('')
  const [baseURL, setBaseURL] = useState(settings.baseURL)
  const [model, setModel] = useState(settings.model)
  const [showKey, setShowKey] = useState(false)
  const [approvalMode, setApprovalMode] = useState(settings.approvalMode)
  const [mcpEnabled, setMcpEnabled] = useState(settings.mcpServerEnabled)
  const [mcpPort, setMcpPort] = useState(settings.mcpServerPort)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setProvider(settings.aiProvider)
      setApiKey('')
      setBaseURL(settings.baseURL)
      setModel(settings.model)
      setApprovalMode(settings.approvalMode)
      setMcpEnabled(settings.mcpServerEnabled)
      setMcpPort(settings.mcpServerPort)
      setSaved(false)
      loadKeyStatus()
    }
  }, [isOpen])

  const handleSave = async () => {
    await updateSettings({
      aiProvider: provider,
      apiKey: apiKey || undefined,
      baseURL,
      model,
      approvalMode,
      mcpServerEnabled: mcpEnabled,
      mcpServerPort: mcpPort
    })
    setApiKey('')
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (!isOpen) return <></>

  const models = DEFAULT_AI_MODELS[provider] || []

  const field =
    'w-full bg-ink rounded-lg px-3 py-2 text-sm border border-line text-cream focus:border-accent/60 outline-none transition-colors'
  const label = 'block text-xs text-muted mb-1.5 font-mono'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 fade-in" onClick={closeSettings}>
      <div
        className="w-[560px] max-h-[82vh] bg-panel rounded-xl border border-line shadow-lift overflow-hidden flex flex-col fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <div className="flex items-center gap-3">
            <span className="font-mono text-base font-semibold text-cream">Settings</span>
            <span className="term-label text-accent">// BYOK</span>
          </div>
          <button onClick={closeSettings} className="p-1.5 rounded-md text-muted hover:text-cream hover:bg-panel-3 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          <section>
            <h3 className="term-label mb-3 text-accent">01 // AI PROVIDER</h3>

            <label className={label}>provider</label>
            <select
              value={provider}
              onChange={(e) => {
                const p = e.target.value as AIProvider
                setProvider(p)
                setBaseURL(PROVIDER_BASE_URLS[p] || '')
                setModel(DEFAULT_AI_MODELS[p]?.[0] || '')
              }}
              className={`${field} mb-4`}
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Google Gemini</option>
              <option value="ollama">Ollama (local)</option>
              <option value="custom">Custom (OpenAI-compatible)</option>
            </select>

            <div className="flex items-center gap-2 mb-1.5">
              <label className="text-xs text-muted font-mono flex-1">api key</label>
              {keyStatus[provider] && (
                <span className="text-[11px] font-mono text-agent-running">✓ saved</span>
              )}
            </div>
            <div className="relative mb-4">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={keyStatus[provider] ? '••••••••  (enter a new key to replace)' : 'enter API key…'}
                className={`${field} pr-10 font-mono`}
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-cream transition-colors"
              >
                {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>

            <label className={label}>base url</label>
            <input
              type="text"
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
              placeholder={PROVIDER_BASE_URLS[provider] || 'https://…'}
              className={`${field} mb-4 font-mono`}
            />

            <label className={label}>model</label>
            {models.length > 0 ? (
              <select value={model} onChange={(e) => setModel(e.target.value)} className={field}>
                {models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
                <option value="">custom…</option>
              </select>
            ) : (
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="model name…"
                className={`${field} font-mono`}
              />
            )}

            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={() => testConnection()}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-sm bg-panel-3 border border-line rounded-lg
                           hover:border-accent/50 hover:text-cream text-muted transition-colors"
              >
                <Plug size={14} /> Test connection
              </button>
              {testResult && (
                <div className={`flex-1 text-xs font-mono ${testResult.success ? 'text-agent-running' : 'text-red-400'}`}>
                  {testResult.success ? `✓ ${testResult.message}` : `✗ ${testResult.message}`}
                </div>
              )}
            </div>
          </section>

          <section>
            <h3 className="term-label mb-3 text-accent">02 // AGENT</h3>
            <label className={label}>approval mode</label>
            <select
              value={approvalMode}
              onChange={(e) => setApprovalMode(e.target.value as 'always' | 'sensitive' | 'never')}
              className={field}
            >
              <option value="always">Always ask before actions</option>
              <option value="sensitive">Ask only for sensitive actions</option>
              <option value="never">Never ask (fully autonomous)</option>
            </select>
          </section>

          <section>
            <h3 className="term-label mb-3 text-accent">03 // MCP SERVER</h3>
            <label className="flex items-center gap-2.5 mb-3 cursor-pointer">
              <input
                type="checkbox"
                checked={mcpEnabled}
                onChange={(e) => setMcpEnabled(e.target.checked)}
                className="accent-accent w-4 h-4"
              />
              <span className="text-sm text-cream/90">Expose browser control to external agents</span>
            </label>
            {mcpEnabled && (
              <div>
                <label className={label}>port</label>
                <input
                  type="number"
                  value={mcpPort}
                  onChange={(e) => setMcpPort(parseInt(e.target.value) || 3900)}
                  className={`${field} w-32 font-mono`}
                />
              </div>
            )}
          </section>

          <section className="flex items-start gap-3 p-3.5 rounded-lg bg-panel-2 border border-line/60">
            <ShieldCheck size={18} className="text-agent-running flex-shrink-0 mt-0.5" />
            <p className="text-xs text-muted leading-relaxed">
              API keys are encrypted with your OS keychain (safeStorage). Keys never leave your
              machine. No telemetry, no cloud sync.
            </p>
          </section>
        </div>

        <div className="px-5 py-3.5 border-t border-line flex items-center justify-between">
          {saved && <span className="text-xs font-mono text-agent-running">✓ settings saved</span>}
          <div className="flex gap-2 ml-auto">
            <button
              onClick={closeSettings}
              className="px-4 py-1.5 text-sm bg-panel-3 border border-line rounded-lg text-muted hover:text-cream transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-1.5 text-sm bg-accent text-ink font-semibold rounded-lg hover:bg-accent-hover transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
