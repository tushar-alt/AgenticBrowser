import React, { useState, useEffect } from 'react'
import { X, Plug, Eye, EyeOff, ShieldCheck, Globe, Palette, KeyRound, Bot, SlidersHorizontal, FolderOpen, Trash2 } from 'lucide-react'
import { useSettingsStore } from '../../store/settingsStore'
import { AIProvider, SavedPasswordMeta, SearchEngineId } from '@shared/types'
import { DEFAULT_AI_MODELS, PROVIDER_BASE_URLS, PROVIDER_LABELS, SEARCH_ENGINES } from '@shared/constants'

type Section = 'general' | 'appearance' | 'privacy' | 'passwords' | 'ai' | 'agent' | 'advanced'

const SECTIONS: Array<{ id: Section; label: string; icon: React.ReactNode }> = [
  { id: 'general', label: 'General', icon: <SlidersHorizontal size={14} /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette size={14} /> },
  { id: 'privacy', label: 'Privacy & Security', icon: <ShieldCheck size={14} /> },
  { id: 'passwords', label: 'Passwords', icon: <KeyRound size={14} /> },
  { id: 'ai', label: 'AI Provider', icon: <Globe size={14} /> },
  { id: 'agent', label: 'Agent', icon: <Bot size={14} /> },
  { id: 'advanced', label: 'Advanced', icon: <Plug size={14} /> }
]

export function SettingsPanel(): React.JSX.Element {
  const {
    settings, isOpen, keyStatus, testResult,
    closeSettings, updateSettings, testConnection, loadKeyStatus
  } = useSettingsStore()

  const [section, setSection] = useState<Section>('general')
  const [provider, setProvider] = useState<AIProvider>(settings.aiProvider)
  const [apiKey, setApiKey] = useState('')
  const [baseURL, setBaseURL] = useState(settings.baseURL)
  const [model, setModel] = useState(settings.model)
  const [showKey, setShowKey] = useState(false)
  const [approvalMode, setApprovalMode] = useState(settings.approvalMode)
  const [maxSteps, setMaxSteps] = useState(settings.maxAgentSteps)
  const [mcpEnabled, setMcpEnabled] = useState(settings.mcpServerEnabled)
  const [mcpPort, setMcpPort] = useState(settings.mcpServerPort)
  const [saved, setSaved] = useState(false)

  // Passwords state
  const [passwords, setPasswords] = useState<SavedPasswordMeta[]>([])
  const [revealed, setRevealed] = useState<Record<string, string>>({})

  // Subscription sign-in state
  const [oauth, setOauth] = useState<Record<string, { connected: boolean }>>({})
  const [signingIn, setSigningIn] = useState<string | null>(null)

  const refreshOauth = () => {
    window.api?.oauth?.status().then(setOauth).catch(() => {})
  }

  useEffect(() => {
    if (isOpen) {
      setProvider(settings.aiProvider)
      setApiKey('')
      setBaseURL(settings.baseURL)
      setModel(settings.model)
      setApprovalMode(settings.approvalMode)
      setMaxSteps(settings.maxAgentSteps)
      setMcpEnabled(settings.mcpServerEnabled)
      setMcpPort(settings.mcpServerPort)
      setSaved(false)
      loadKeyStatus()
    }
  }, [isOpen])

  useEffect(() => {
    if (isOpen && section === 'passwords') {
      window.api?.passwords?.list().then(setPasswords).catch(() => {})
    }
  }, [isOpen, section])

  useEffect(() => {
    if (isOpen) refreshOauth()
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSettings()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen])

  const commit = async (partial: Parameters<typeof updateSettings>[0]) => {
    await updateSettings(partial)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const handleSave = async () => {
    await updateSettings({
      aiProvider: provider,
      apiKey: apiKey || undefined,
      baseURL,
      model,
      approvalMode,
      maxAgentSteps: maxSteps,
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

  const Toggle = ({ checked, onChange, title, hint }: { checked: boolean; onChange: (v: boolean) => void; title: string; hint?: string }) => (
    <label className="flex items-start gap-3 py-2 cursor-pointer group">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-accent w-4 h-4 mt-0.5"
      />
      <span className="flex-1">
        <span className="block text-sm text-cream/90 group-hover:text-cream">{title}</span>
        {hint && <span className="block text-[11px] text-muted mt-0.5 leading-snug">{hint}</span>}
      </span>
    </label>
  )

  const deletePassword = async (id: string) => {
    await window.api?.passwords?.remove(id)
    setPasswords((p) => p.filter((x) => x.id !== id))
  }

  const revealPassword = async (id: string) => {
    if (revealed[id]) {
      setRevealed((r) => { const n = { ...r }; delete n[id]; return n })
      return
    }
    const pw = await window.api?.passwords?.reveal(id)
    if (pw) setRevealed((r) => ({ ...r, [id]: pw }))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 fade-in" onClick={closeSettings}>
      <div
        className="w-[860px] h-[620px] max-h-[86vh] bg-panel rounded-xl border border-line shadow-lift overflow-hidden flex flex-col fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-line flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="font-mono text-base font-semibold text-cream">Settings</span>
            {saved && <span className="term-label text-agent-running">saved ✓</span>}
          </div>
          <button onClick={closeSettings} className="p-1.5 rounded-md text-muted hover:text-cream hover:bg-panel-3 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <div className="w-48 border-r border-line py-2 flex-shrink-0 overflow-y-auto">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors ${
                  section === s.id
                    ? 'bg-accent/10 text-accent border-l-2 border-accent'
                    : 'text-muted hover:text-cream hover:bg-panel-2 border-l-2 border-transparent'
                }`}
              >
                {s.icon}
                <span className="truncate">{s.label}</span>
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {section === 'general' && (
              <div className="space-y-6">
                <h3 className="term-label text-accent">GENERAL</h3>

                <div>
                  <label className={label}>search engine</label>
                  <select
                    value={settings.searchEngine}
                    onChange={(e) => commit({ searchEngine: e.target.value as SearchEngineId })}
                    className={`${field} mb-3`}
                  >
                    {SEARCH_ENGINES.map((e) => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                  {settings.searchEngine === 'custom' && (
                    <>
                      <label className={label}>custom search url (use %s for the query)</label>
                      <input
                        type="text"
                        defaultValue={settings.customSearchUrl}
                        onBlur={(e) => commit({ customSearchUrl: e.target.value })}
                        placeholder="https://myengine.com/search?q=%s"
                        className={`${field} font-mono`}
                      />
                    </>
                  )}
                </div>

                <div>
                  <label className={label}>default page zoom</label>
                  <select
                    value={String(settings.defaultZoom)}
                    onChange={(e) => commit({ defaultZoom: Number(e.target.value) })}
                    className={`${field} w-40`}
                  >
                    {[0.8, 0.9, 1, 1.1, 1.25, 1.5].map((z) => (
                      <option key={z} value={String(z)}>{Math.round(z * 100)}%</option>
                    ))}
                  </select>
                </div>

                <div className="border-t border-line pt-4">
                  <Toggle
                    checked={settings.restoreSession}
                    onChange={(v) => commit({ restoreSession: v })}
                    title="Continue where you left off"
                    hint="Reopen the tabs from your last session on startup."
                  />
                </div>

                <div className="border-t border-line pt-4">
                  <label className={label}>downloads</label>
                  <Toggle
                    checked={settings.askDownloadLocation}
                    onChange={(v) => commit({ askDownloadLocation: v })}
                    title="Ask where to save each file"
                  />
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      type="text"
                      readOnly
                      value={settings.downloadPath || 'Default (Downloads folder)'}
                      className={`${field} flex-1 font-mono text-xs cursor-default`}
                    />
                    <button
                      onClick={async () => {
                        const dir = await window.api?.downloads?.chooseDir()
                        if (dir) await commit({ downloadPath: dir })
                      }}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm bg-panel-3 border border-line rounded-lg hover:border-accent/50 text-muted hover:text-cream transition-colors"
                    >
                      <FolderOpen size={14} /> Browse
                    </button>
                  </div>
                </div>
              </div>
            )}

            {section === 'appearance' && (
              <div className="space-y-6">
                <h3 className="term-label text-accent">APPEARANCE</h3>
                <div>
                  <label className={label}>theme</label>
                  <div className="grid grid-cols-3 gap-3">
                    {([
                      { id: 'dark', label: 'Dark', swatch: ['#0e0e10', '#f26522'] },
                      { id: 'light', label: 'Light', swatch: ['#f6f5f1', '#e05814'] },
                      { id: 'system', label: 'System', swatch: ['#3a3a42', '#e05814'] }
                    ] as const).map((t) => (
                      <button
                        key={t.id}
                        onClick={() => commit({ theme: t.id })}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          settings.theme === t.id
                            ? 'border-accent shadow-glow bg-accent/5'
                            : 'border-line hover:border-accent/40 bg-panel-2'
                        }`}
                      >
                        <div className="flex gap-1.5 mb-2.5">
                          <span className="w-6 h-6 rounded-md border border-line" style={{ background: t.swatch[0] }} />
                          <span className="w-6 h-6 rounded-md" style={{ background: t.swatch[1] }} />
                        </div>
                        <span className="text-sm text-cream">{t.label}</span>
                        {settings.theme === t.id && <span className="ml-2 text-[11px] font-mono text-accent">active</span>}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted mt-3">
                    System follows your Windows dark/light preference live.
                  </p>
                </div>
              </div>
            )}

            {section === 'privacy' && (
              <div className="space-y-6">
                <h3 className="term-label text-accent">PRIVACY &amp; SECURITY</h3>
                <Toggle
                  checked={settings.doNotTrack}
                  onChange={(v) => commit({ doNotTrack: v })}
                  title="Send a “Do Not Track” request"
                  hint="Adds the DNT header to every request. Sites may ignore it."
                />
                <div className="border-t border-line pt-4">
                  <label className={label}>clear browsing data</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => window.api?.browsingData?.clear({ cache: true, cookies: false })}
                      className="px-3.5 py-1.5 text-sm bg-panel-3 border border-line rounded-lg hover:border-accent/50 text-muted hover:text-cream transition-colors"
                    >
                      Clear cache
                    </button>
                    <button
                      onClick={() => window.api?.browsingData?.clear({ cache: true, cookies: true })}
                      className="px-3.5 py-1.5 text-sm bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 hover:bg-red-500/20 transition-colors"
                    >
                      Clear cookies &amp; site data
                    </button>
                  </div>
                  <p className="text-[11px] text-muted mt-2">
                    Applies to every tab’s isolated session. You will be signed out of sites.
                  </p>
                </div>
              </div>
            )}

            {section === 'passwords' && (
              <div className="space-y-5">
                <h3 className="term-label text-accent">PASSWORDS</h3>
                <Toggle
                  checked={settings.savePasswords}
                  onChange={(v) => commit({ savePasswords: v })}
                  title="Save passwords"
                  hint="When you sign in to a site, the credentials are stored encrypted (OS keychain) on this device."
                />
                <Toggle
                  checked={settings.autoSignin}
                  onChange={(v) => commit({ autoSignin: v })}
                  title="Auto sign-in"
                  hint="Fill saved credentials into login forms automatically."
                />

                <div className="border-t border-line pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className={label + ' mb-0'}>saved passwords ({passwords.length})</label>
                    {passwords.length > 0 && (
                      <button
                        onClick={async () => {
                          await window.api?.passwords?.clear()
                          setPasswords([])
                        }}
                        className="text-[11px] font-mono text-red-400 hover:text-red-300 transition-colors"
                      >
                        clear all
                      </button>
                    )}
                  </div>
                  {passwords.length === 0 ? (
                    <div className="text-xs text-muted/60 font-mono italic py-4">
                      No passwords saved yet. Sign in to a site and they will appear here.
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {passwords.map((p) => (
                        <div key={p.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-panel-2 border border-line">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-cream truncate">{p.origin}</div>
                            <div className="text-[11px] text-muted font-mono truncate">
                              {p.username || '(no username)'} · {revealed[p.id] ? revealed[p.id] : '••••••••'}
                            </div>
                          </div>
                          <button
                            onClick={() => revealPassword(p.id)}
                            className="p-1.5 rounded-md text-muted hover:text-cream hover:bg-panel-3 transition-colors"
                            title={revealed[p.id] ? 'Hide' : 'Reveal'}
                          >
                            {revealed[p.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                          <button
                            onClick={() => deletePassword(p.id)}
                            className="p-1.5 rounded-md text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {section === 'ai' && (
              <div className="space-y-4">
                <h3 className="term-label text-accent">SUBSCRIPTION SIGN-IN</h3>
                <p className="text-xs text-muted leading-relaxed -mt-2">
                  Use a subscription you already pay for — no API keys. The agent and chat run on
                  your plan. Tokens are stored encrypted on this device only.
                </p>

                {([
                  { id: 'claude', provider: 'claude-oauth', name: 'Claude Pro / Max', desc: 'Sign in with your Claude.ai account', plan: 'claude.ai subscription' },
                  { id: 'chatgpt', provider: 'chatgpt-oauth', name: 'ChatGPT Plus / Pro', desc: 'Sign in with your ChatGPT account', plan: 'chatgpt.com subscription' }
                ] as const).map((p) => {
                  const connected = oauth[p.id]?.connected
                  return (
                    <div key={p.id} className="flex items-center gap-3 p-3.5 rounded-xl bg-panel-2 border border-line">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${connected ? 'bg-agent-running' : 'bg-muted/40'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-cream">{p.name}</div>
                        <div className="text-[11px] text-muted font-mono truncate">
                          {connected ? 'Connected — agent runs on your subscription' : p.desc}
                        </div>
                      </div>
                      {connected ? (
                        <button
                          onClick={async () => {
                            await window.api?.oauth?.disconnect(p.id)
                            refreshOauth()
                            await updateSettings({ aiProvider: settings.aiProvider === p.provider ? 'openai' : settings.aiProvider })
                          }}
                          className="px-3 py-1.5 text-xs rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-colors"
                        >
                          Disconnect
                        </button>
                      ) : (
                        <button
                          disabled={signingIn === p.id}
                          onClick={async () => {
                            setSigningIn(p.id)
                            try {
                              await window.api?.oauth?.signIn(p.id)
                              refreshOauth()
                              await updateSettings({ aiProvider: p.provider })
                            } catch { /* user cancelled or timed out */ }
                            setSigningIn(null)
                          }}
                          className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-accent text-ink hover:bg-accent-hover disabled:opacity-50 transition-colors"
                        >
                          {signingIn === p.id ? 'Waiting…' : 'Sign in'}
                        </button>
                      )}
                    </div>
                  )
                })}

                <div className="flex items-center gap-3 p-3.5 rounded-xl bg-panel-2 border border-line">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${settings.aiProvider === 'zai' ? 'bg-agent-running' : 'bg-muted/40'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-cream">Z.ai — GLM Coding Plan</div>
                    <div className="text-[11px] text-muted font-mono">Connect your plan API key (Anthropic-compatible)</div>
                  </div>
                  <button
                    onClick={() => {
                      setProvider('zai')
                      setBaseURL(PROVIDER_BASE_URLS['zai'] || '')
                      setModel('glm-4.6')
                    }}
                    className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-panel-3 border border-line text-cream hover:border-accent/50 transition-colors"
                  >
                    Connect key ↓
                  </button>
                </div>

                <div className="border-t border-line pt-5">
                  <h3 className="term-label text-accent mb-3">MANUAL / API KEYS</h3>
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
                  {(['openai', 'anthropic', 'gemini', 'zai', 'ollama', 'custom'] as AIProvider[]).map((p) => (
                    <option key={p} value={p}>{PROVIDER_LABELS[p] || p}</option>
                  ))}
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
                </div>
              </div>
            )}

            {section === 'agent' && (
              <div className="space-y-4">
                <h3 className="term-label text-accent">AGENT</h3>
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

                <label className={label}>max steps per task</label>
                <input
                  type="number"
                  min={3}
                  max={50}
                  value={maxSteps}
                  onChange={(e) => setMaxSteps(parseInt(e.target.value) || 15)}
                  className={`${field} w-32 font-mono`}
                />
              </div>
            )}

            {section === 'advanced' && (
              <div className="space-y-4">
                <h3 className="term-label text-accent">MCP SERVER</h3>
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

                <div className="flex items-start gap-3 p-3.5 rounded-lg bg-panel-2 border border-line/60">
                  <ShieldCheck size={18} className="text-agent-running flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-muted leading-relaxed">
                    API keys are encrypted with your OS keychain (safeStorage). Saved passwords are
                    encrypted with DPAPI and never leave this device. No telemetry, no cloud sync.
                  </p>
                </div>
              </div>
            )}
          </div>

        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-line flex-shrink-0 bg-panel">
          <button
            onClick={closeSettings}
            className="px-4 py-1.5 text-sm rounded-lg bg-panel-3 text-muted hover:text-cream transition-colors"
          >
            Close
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-1.5 text-sm rounded-lg bg-accent text-ink font-semibold hover:bg-accent-hover transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
