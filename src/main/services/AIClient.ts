import crypto from 'crypto'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import axios from 'axios'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { AIProviderConfig, ChatMessage, VisionImage } from '@shared/types'
import { net, session as electronSession } from 'electron'
import { SecureStorage } from './SecureStorage'
import { getSettings } from './AppSettingsStore'
import { OAuthAccounts } from './OAuthAccounts'

interface StreamCallbacks {
  onToken: (token: string) => void
  onComplete: (fullText: string) => void
  onError: (error: string) => void
}

/**
 * Zero-config fallback: enabled providers from the local ZCode config
 * (~/.zcode/v2/config.json). Only used when the user has not configured their
 * own key in Settings. Keys stay local and are never persisted by this app.
 */
function loadZCodeFallbackConfigs(): AIProviderConfig[] {
  const out: AIProviderConfig[] = []
  try {
    const file = process.env.ZCODE_CONFIG || path.join(os.homedir(), '.zcode', 'v2', 'config.json')
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      provider?: Record<string, {
        name?: string
        kind?: string
        enabled?: boolean
        options?: { apiKey?: string; baseURL?: string }
        models?: Record<string, unknown>
      }>
    }
    for (const p of Object.values(cfg.provider || {})) {
      if (p?.enabled === false || !p?.options?.apiKey || !p?.options?.baseURL) continue
      const models = Object.keys(p.models || {})
      if (models.length === 0) continue
      out.push({
        provider: p.kind === 'anthropic' ? 'anthropic' : 'custom',
        apiKey: p.options.apiKey!,
        baseURL: p.options.baseURL,
        model: models.includes('GLM-5.3-Flash') ? 'GLM-5.3-Flash' : models[0]
      })
    }
    out.sort((a, b) => (a.model === 'GLM-5.3-Flash' ? 0 : 1) - (b.model === 'GLM-5.3-Flash' ? 0 : 1))
  } catch { /* no config -> no fallback */ }
  return out
}

export class AIClient {
  private secureStorage: SecureStorage
  private openaiClient: OpenAI | null = null
  private anthropicClient: Anthropic | null = null
  private anthropicBaseURL: string | null = null
  private anthropicBearer: boolean = false
  private oauth: OAuthAccounts

  constructor(secureStorage: SecureStorage, oauth?: OAuthAccounts) {
    this.secureStorage = secureStorage
    this.oauth = oauth || new OAuthAccounts()
  }

  private getStoredProviderConfig(): AIProviderConfig | null {
    // ISSUE 2 (authoritative source): the ACTIVE provider lives in settings
    // (what the UI shows), not in a second pointer that can go stale.
    const provider = getSettings().aiProvider || this.secureStorage.getActiveProvider()
    // ISSUE 2: the authoritative model/endpoint live in AppSettingsStore
    // (Settings writes there), not in SecureStorage's per-provider config.
    const appSettings = getSettings()
    const settingsModel = appSettings.model || undefined
    const settingsBaseURL = appSettings.baseURL || undefined
    const config = { model: settingsModel || undefined, baseURL: settingsBaseURL || undefined }

    // Subscription sign-in providers authenticate via OAuth, not stored keys.
    if (provider === 'claude-oauth' || provider === 'chatgpt-oauth' || provider === 'gemini-oauth') {
      const kind = provider === 'claude-oauth' ? 'claude' : provider === 'chatgpt-oauth' ? 'chatgpt' : 'gemini'
      if (!this.oauth.status(kind).connected) return null
      return { provider, apiKey: '', model: settingsModel || (provider === 'gemini-oauth' ? 'gemini-2.5-flash' : config?.model) }
    }
    // Gemini Web: anonymous access, no key, no sign-in
    if (provider === 'gemini-web') {
      return { provider, apiKey: '', model: settingsModel || 'gemini-web-flash' }
    }
    // ISSUE 2: local-only inference — never fall back to a cloud provider
    if (provider === 'ollama') {
      return {
        provider,
        apiKey: '',
        baseURL: settingsBaseURL || 'http://localhost:11434',
        model: settingsModel || 'tinyllama:1.1b'
      }
    }
    const apiKey = this.secureStorage.getKey()
    if (!apiKey) return null
    return {
      provider,
      apiKey,
      baseURL: config?.baseURL,
      model: config?.model
    }
  }

  /**
   * Candidate configs in priority order: the user's own Settings key first,
   * then local ZCode config providers. Calls iterate until one succeeds so an
   * expired/invalid fallback credential doesn't break the app.
   */
  private getProviderConfigs(): AIProviderConfig[] {
    const configs: AIProviderConfig[] = []
    const stored = this.getStoredProviderConfig()
    if (stored) configs.push(stored)
    // ISSUE 2: local-only inference must never silently egress to a cloud
    // provider — cloud fallbacks apply only to key-based providers.
    if (stored && (stored.provider === 'ollama' || stored.provider === 'gemini-web' || stored.provider === 'gemini-oauth' || stored.provider === 'claude-oauth' || stored.provider === 'chatgpt-oauth')) {
      return configs
    }
    for (const fb of loadZCodeFallbackConfigs()) {
      configs.push(fb)
    }
    return configs
  }

  private getOpenAIClient(apiKey: string, baseURL?: string): OpenAI {
    if (!this.openaiClient || this.openaiClient.apiKey !== apiKey) {
      this.openaiClient = new OpenAI({
        apiKey,
        baseURL: baseURL || 'https://api.openai.com/v1'
      })
    }
    return this.openaiClient
  }

  private getAnthropicClient(apiKey: string, baseURL?: string, bearer = false): Anthropic {
    if (
      !this.anthropicClient ||
      this.anthropicClient.apiKey !== (bearer ? undefined : apiKey) ||
      this.anthropicBaseURL !== (baseURL || null) ||
      this.anthropicBearer !== bearer
    ) {
      this.anthropicClient = bearer
        ? new Anthropic({ authToken: apiKey, baseURL: baseURL || undefined })
        : new Anthropic({ apiKey, baseURL: baseURL || undefined })
      this.anthropicBaseURL = baseURL || null
      this.anthropicBearer = bearer
    }
    return this.anthropicClient
  }

  async sendMessage(
    messages: ChatMessage[],
    systemPrompt?: string,
    callbacks?: StreamCallbacks,
    opts?: { jsonMode?: boolean }
  ): Promise<string> {
    const configs = this.getProviderConfigs()
    if (configs.length === 0) {
      throw new Error('No AI provider configured. Add an API key in Settings (or install a local ZCode provider).')
    }
    let lastErr: unknown = null
    for (const config of configs) {
      try {
        return await this.dispatchMessage(config, messages, systemPrompt, callbacks, opts)
      } catch (e) {
        lastErr = e
      }
    }
    throw new Error(
      `AI request failed on all providers. Last error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`
    )
  }

  async sendVisionMessage(
    messages: ChatMessage[],
    images: VisionImage[],
    systemPrompt?: string,
    callbacks?: StreamCallbacks
  ): Promise<string> {
    const configs = this.getProviderConfigs()
    if (configs.length === 0) {
      throw new Error('No AI provider configured. Please add an API key in Settings.')
    }
    let lastErr: unknown = null
    for (const config of configs) {
      try {
        return await this.dispatchVisionMessage(config, messages, images, systemPrompt, callbacks)
      } catch (e) {
        lastErr = e
      }
    }
    throw new Error(
      `Vision request failed on all providers. Last error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`
    )
  }

  private async dispatchMessage(
    config: AIProviderConfig,
    messages: ChatMessage[],
    systemPrompt?: string,
    callbacks?: StreamCallbacks,
    opts?: { jsonMode?: boolean }
  ): Promise<string> {
    // Subscription sign-ins: OAuth tokens resolve (and refresh) at call time.
    if (config.provider === 'claude-oauth') {
      const token = await this.oauth.accessToken('claude')
      return this.sendAnthropicMessage(
        { ...config, provider: 'anthropic', apiKey: token, oauthBearer: true, model: config.model || 'claude-sonnet-4-20250514' },
        messages, systemPrompt, callbacks
      )
    }
    if (config.provider === 'chatgpt-oauth') {
      const token = await this.oauth.accessToken('chatgpt')
      return this.sendOpenAIResponses(
        { ...config, provider: 'openai', apiKey: token, model: config.model || 'gpt-5' },
        messages, systemPrompt, callbacks
      )
    }
    if (config.provider === 'gemini-web') {
      return this.sendGeminiWeb(config, messages, systemPrompt, callbacks)
    }
    if (config.provider === 'gemini-oauth') {
      const token = await this.oauth.accessToken('gemini')
      return this.sendGeminiCodeAssist(
        { ...config, provider: 'gemini-oauth', apiKey: token },
        messages, systemPrompt, callbacks
      )
    }
    if (config.provider === 'zai') {
      // Z.ai GLM Coding Plan: Anthropic-compatible endpoint, plan API key.
      return this.sendAnthropicMessage(
        { ...config, provider: 'anthropic', baseURL: config.baseURL || 'https://api.z.ai/api/anthropic', model: config.model || 'glm-4.6' },
        messages, systemPrompt, callbacks
      )
    }
    switch (config.provider) {
      case 'openai':
      case 'custom':
        return this.sendOpenAIMessage(config, messages, systemPrompt, callbacks)
      case 'anthropic':
        return this.sendAnthropicMessage(config, messages, systemPrompt, callbacks)
      case 'gemini':
        return this.sendGeminiMessage(config, messages, systemPrompt, callbacks)
      case 'ollama':
        return this.sendOllamaMessage(config, messages, systemPrompt, callbacks, opts)
      default:
        throw new Error(`Unsupported provider: ${config.provider}`)
    }
  }

  private async dispatchVisionMessage(
    config: AIProviderConfig,
    messages: ChatMessage[],
    images: VisionImage[],
    systemPrompt?: string,
    callbacks?: StreamCallbacks
  ): Promise<string> {
    if (config.provider === 'claude-oauth') {
      const token = await this.oauth.accessToken('claude')
      return this.sendAnthropicVisionMessage(
        { ...config, provider: 'anthropic', apiKey: token, oauthBearer: true, model: config.model || 'claude-sonnet-4-20250514' },
        messages, images, systemPrompt, callbacks
      )
    }
    if (config.provider === 'chatgpt-oauth') {
      throw new Error('Vision is not yet supported for ChatGPT subscription sign-in — use an API key for screenshots.')
    }
    if (config.provider === 'gemini-web') {
      throw new Error('Vision is not supported for Gemini Web (anonymous) — use an API key or subscription sign-in for screenshots.')
    }
    if (config.provider === 'zai') {
      return this.sendAnthropicVisionMessage(
        { ...config, provider: 'anthropic', baseURL: config.baseURL || 'https://api.z.ai/api/anthropic', model: config.model || 'glm-4.6' },
        messages, images, systemPrompt, callbacks
      )
    }
    switch (config.provider) {
      case 'openai':
      case 'custom':
        return this.sendOpenAIVisionMessage(config, messages, images, systemPrompt, callbacks)
      case 'anthropic':
        return this.sendAnthropicVisionMessage(config, messages, images, systemPrompt, callbacks)
      case 'gemini':
        return this.sendGeminiVisionMessage(config, messages, images, systemPrompt, callbacks)
      case 'ollama':
        return this.sendOllamaVisionMessage(config, messages, images, systemPrompt, callbacks)
      default:
        throw new Error(`Vision not supported for provider: ${config.provider}`)
    }
  }

  private async sendOpenAIMessage(
    config: AIProviderConfig,
    messages: ChatMessage[],
    systemPrompt?: string,
    callbacks?: StreamCallbacks
  ): Promise<string> {
    const client = this.getOpenAIClient(config.apiKey, config.baseURL)
    const model = config.model || 'gpt-4o'

    const formattedMessages: OpenAI.Chat.ChatCompletionMessageParam[] = []
    if (systemPrompt) {
      formattedMessages.push({ role: 'system', content: systemPrompt })
    }
    for (const msg of messages) {
      formattedMessages.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content
      })
    }

    if (callbacks) {
      const stream = await client.chat.completions.create({
        model,
        messages: formattedMessages,
        stream: true,
        max_tokens: 4096
      })

      let fullText = ''
      for await (const chunk of stream) {
        const token = chunk.choices[0]?.delta?.content || ''
        if (token) {
          fullText += token
          callbacks.onToken(token)
        }
      }
      callbacks.onComplete(fullText)
      return fullText
    }

    const response = await client.chat.completions.create({
      model,
      messages: formattedMessages,
      max_tokens: 4096
    })

    return response.choices[0]?.message?.content || ''
  }

  private async sendAnthropicMessage(
    config: AIProviderConfig,
    messages: ChatMessage[],
    systemPrompt?: string,
    callbacks?: StreamCallbacks
  ): Promise<string> {
    const client = this.getAnthropicClient(config.apiKey, config.baseURL, config.oauthBearer === true)
    const model = config.model || 'claude-sonnet-4-20250514'
    const extraHeaders = config.oauthBearer ? { 'anthropic-beta': 'oauth-2025-04-20' } : undefined

    const formattedMessages: Anthropic.MessageParam[] = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      }))

    if (callbacks) {
      const stream = client.messages.stream({
        model,
        max_tokens: 4096,
        system: systemPrompt || undefined,
        messages: formattedMessages
      }, { headers: extraHeaders })

      let fullText = ''
      stream.on('text', (text) => {
        fullText += text
        callbacks.onToken(text)
      })

      await stream.finalMessage()
      callbacks.onComplete(fullText)
      return fullText
    }

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt || undefined,
      messages: formattedMessages
    }, { headers: extraHeaders })

    const textBlock = response.content.find((b) => b.type === 'text')
    return textBlock ? (textBlock as Anthropic.TextBlock).text : ''
  }

  private async sendGeminiMessage(
    config: AIProviderConfig,
    messages: ChatMessage[],
    systemPrompt?: string,
    callbacks?: StreamCallbacks
  ): Promise<string> {
    const model = config.model || 'gemini-1.5-pro'
    const baseURL = config.baseURL || 'https://generativelanguage.googleapis.com/v1beta'

    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }))

    const body: Record<string, unknown> = { contents }
    if (systemPrompt) {
      body.systemInstruction = { parts: [{ text: systemPrompt }] }
    }

    if (callbacks) {
      // Use streaming endpoint
      const url = `${baseURL}/models/${model}:streamGenerateContent?alt=sse&key=${config.apiKey}`
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          const errorMsg = (errorData as { error?: { message?: string } })?.error?.message || response.statusText
          callbacks.onError(errorMsg)
          throw new Error(`Gemini API error: ${errorMsg}`)
        }

        let fullText = ''
        const reader = response.body?.getReader()
        const decoder = new TextDecoder()

        if (reader) {
          let buffer = ''
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6).trim()
                if (data === '[DONE]') continue
                try {
                  const parsed = JSON.parse(data)
                  const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || ''
                  if (text) {
                    fullText += text
                    callbacks.onToken(text)
                  }
                } catch {
                  // Skip malformed JSON
                }
              }
            }
          }
        }

        callbacks.onComplete(fullText)
        return fullText
      } catch (error: unknown) {
        if (error instanceof Error && error.message.startsWith('Gemini API error:')) throw error
        const msg = String(error)
        callbacks.onError(msg)
        throw new Error(`Gemini API error: ${msg}`)
      }
    }

    // Non-streaming fallback
    const url = `${baseURL}/models/${model}:generateContent?key=${config.apiKey}`
    try {
      const response = await axios.post(url, body, {
        headers: { 'Content-Type': 'application/json' }
      })
      return response.data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    } catch (error: unknown) {
      const msg = axios.isAxiosError(error)
        ? error.response?.data?.error?.message || error.message
        : String(error)
      throw new Error(`Gemini API error: ${msg}`)
    }
  }

  private async sendOllamaMessage(
    config: AIProviderConfig,
    messages: ChatMessage[],
    systemPrompt?: string,
    callbacks?: StreamCallbacks,
    opts?: { jsonMode?: boolean }
  ): Promise<string> {
    const model = config.model || 'llama3.1'
    const baseURL = config.baseURL || 'http://localhost:11434'
    const url = `${baseURL}/api/chat`

    const formattedMessages: Array<{ role: string; content: string }> = []
    if (systemPrompt) {
      formattedMessages.push({ role: 'system', content: systemPrompt })
    }
    for (const msg of messages) {
      formattedMessages.push({ role: msg.role, content: msg.content })
    }

    if (callbacks) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: formattedMessages, stream: true, ...(opts?.jsonMode ? { format: 'json' } : {}) })
      })

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.statusText}`)
      }

      let fullText = ''
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value, { stream: true })
          const lines = chunk.split('\n').filter(Boolean)

          for (const line of lines) {
            try {
              const parsed = JSON.parse(line)
              const token = parsed.message?.content || ''
              if (token) {
                fullText += token
                callbacks.onToken(token)
              }
            } catch {
              // Skip malformed JSON lines
            }
          }
        }
      }

      callbacks.onComplete(fullText)
      return fullText
    }

    const response = await axios.post(url, {
      model,
      messages: formattedMessages,
      stream: false,
      ...(opts?.jsonMode ? { format: 'json' } : {})
    })

    return response.data?.message?.content || ''
  }

  private async sendOpenAIVisionMessage(
    config: AIProviderConfig,
    messages: ChatMessage[],
    images: VisionImage[],
    systemPrompt?: string,
    callbacks?: StreamCallbacks
  ): Promise<string> {
    const client = this.getOpenAIClient(config.apiKey, config.baseURL)
    const model = config.model || 'gpt-4o'

    const formattedMessages: OpenAI.Chat.ChatCompletionMessageParam[] = []
    if (systemPrompt) {
      formattedMessages.push({ role: 'system', content: systemPrompt })
    }

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      if (i === messages.length - 1 && msg.role === 'user' && images.length > 0) {
        const content: OpenAI.Chat.ChatCompletionContentPart[] = [
          { type: 'text', text: msg.content }
        ]
        for (const img of images) {
          content.push({
            type: 'image_url',
            image_url: { url: `data:${img.mimeType};base64,${img.data}` }
          })
        }
        formattedMessages.push({ role: 'user', content })
      } else {
        formattedMessages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content
        })
      }
    }

    if (callbacks) {
      const stream = await client.chat.completions.create({
        model,
        messages: formattedMessages,
        stream: true,
        max_tokens: 4096
      })

      let fullText = ''
      for await (const chunk of stream) {
        const token = chunk.choices[0]?.delta?.content || ''
        if (token) {
          fullText += token
          callbacks.onToken(token)
        }
      }
      callbacks.onComplete(fullText)
      return fullText
    }

    const response = await client.chat.completions.create({
      model,
      messages: formattedMessages,
      max_tokens: 4096
    })

    return response.choices[0]?.message?.content || ''
  }

  private async sendAnthropicVisionMessage(
    config: AIProviderConfig,
    messages: ChatMessage[],
    images: VisionImage[],
    systemPrompt?: string,
    callbacks?: StreamCallbacks
  ): Promise<string> {
    const client = this.getAnthropicClient(config.apiKey, config.baseURL, config.oauthBearer === true)
    const model = config.model || 'claude-sonnet-4-20250514'
    const extraHeaders = config.oauthBearer ? { 'anthropic-beta': 'oauth-2025-04-20' } : undefined

    const formattedMessages: Anthropic.MessageParam[] = messages
      .filter((m) => m.role !== 'system')
      .map((m, index, arr) => {
        if (index === arr.length - 1 && m.role === 'user' && images.length > 0) {
          const content: Anthropic.ContentBlockParam[] = [
            { type: 'text', text: m.content }
          ]
          for (const img of images) {
            content.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: img.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data: img.data
              }
            })
          }
          return { role: 'user' as const, content }
        }
        return {
          role: m.role as 'user' | 'assistant',
          content: m.content
        }
      })

    if (callbacks) {
      const stream = client.messages.stream({
        model,
        max_tokens: 4096,
        system: systemPrompt || undefined,
        messages: formattedMessages
      }, { headers: extraHeaders })

      let fullText = ''
      stream.on('text', (text) => {
        fullText += text
        callbacks.onToken(text)
      })

      await stream.finalMessage()
      callbacks.onComplete(fullText)
      return fullText
    }

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt || undefined,
      messages: formattedMessages
    }, { headers: extraHeaders })

    const textBlock = response.content.find((b) => b.type === 'text')
    return textBlock ? (textBlock as Anthropic.TextBlock).text : ''
  }

  /**
   * OpenAI Responses API — the endpoint ChatGPT subscription (OAuth) tokens
   * are valid for. Falls back to the ChatGPT backend Codex endpoint when the
   * platform API rejects the account token.
   */
  private async sendOpenAIResponses(
    config: AIProviderConfig,
    messages: ChatMessage[],
    systemPrompt?: string,
    callbacks?: StreamCallbacks
  ): Promise<string> {
    const model = config.model || 'gpt-5'
    const input = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.content }]
      }))
    const body = JSON.stringify({
      model,
      instructions: systemPrompt || undefined,
      input,
      max_output_tokens: 4096,
      stream: !!callbacks
    })
    const endpoints = [
      'https://api.openai.com/v1/responses',
      'https://chatgpt.com/backend-api/codex/responses'
    ]
    let lastErr = ''
    for (const url of endpoints) {
      let res: Response
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`
          },
          body
        })
      } catch (e) {
        lastErr = String(e)
        continue
      }
      if (!res.ok) {
        lastErr = `${res.status}: ${(await res.text()).substring(0, 200)}`
        // 401/403 → account token not valid here, try the next endpoint
        if (res.status === 401 || res.status === 403) continue
        throw new Error(`OpenAI Responses API ${lastErr}`)
      }
      if (!callbacks) {
        const data = (await res.json()) as {
          output: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>
        }
        const texts: string[] = []
        for (const item of data.output || []) {
          for (const c of item.content || []) {
            if (c.type === 'output_text' && c.text) texts.push(c.text)
          }
        }
        return texts.join('')
      }
      // SSE streaming
      let fullText = ''
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      if (reader) {
        let buffer = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          for (const line of lines) {
            if (!line.startsWith('data:')) continue
            const payload = line.slice(5).trim()
            if (!payload || payload === '[DONE]') continue
            try {
              const evt = JSON.parse(payload) as { type?: string; delta?: string }
              if (evt.type === 'response.output_text.delta' && evt.delta) {
                fullText += evt.delta
                callbacks.onToken(evt.delta)
              }
            } catch { /* skip malformed */ }
          }
        }
      }
      callbacks.onComplete(fullText)
      return fullText
    }
    throw new Error(`ChatGPT sign-in could not reach the Responses API (${lastErr}).`)
  }

  private async sendGeminiVisionMessage(
    config: AIProviderConfig,
    messages: ChatMessage[],
    images: VisionImage[],
    systemPrompt?: string,
    callbacks?: StreamCallbacks
  ): Promise<string> {
    const model = config.model || 'gemini-1.5-pro'
    const baseURL = config.baseURL || 'https://generativelanguage.googleapis.com/v1beta'

    const filteredMessages = messages.filter((m) => m.role !== 'system')
    const contents = filteredMessages.map((m, index) => {
      if (index === filteredMessages.length - 1 && m.role === 'user' && images.length > 0) {
        const parts: Array<Record<string, unknown>> = [{ text: m.content }]
        for (const img of images) {
          parts.push({
            inlineData: {
              mimeType: img.mimeType,
              data: img.data
            }
          })
        }
        return { role: 'user', parts }
      }
      return {
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }
    })

    const body: Record<string, unknown> = { contents }
    if (systemPrompt) {
      body.systemInstruction = { parts: [{ text: systemPrompt }] }
    }

    if (callbacks) {
      const url = `${baseURL}/models/${model}:streamGenerateContent?alt=sse&key=${config.apiKey}`
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          const errorMsg = (errorData as { error?: { message?: string } })?.error?.message || response.statusText
          callbacks.onError(errorMsg)
          throw new Error(`Gemini API error: ${errorMsg}`)
        }

        let fullText = ''
        const reader = response.body?.getReader()
        const decoder = new TextDecoder()

        if (reader) {
          let buffer = ''
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6).trim()
                if (data === '[DONE]') continue
                try {
                  const parsed = JSON.parse(data)
                  const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || ''
                  if (text) {
                    fullText += text
                    callbacks.onToken(text)
                  }
                } catch {
                  // Skip malformed JSON
                }
              }
            }
          }
        }

        callbacks.onComplete(fullText)
        return fullText
      } catch (error: unknown) {
        if (error instanceof Error && error.message.startsWith('Gemini API error:')) throw error
        const msg = String(error)
        callbacks.onError(msg)
        throw new Error(`Gemini API error: ${msg}`)
      }
    }

    const url = `${baseURL}/models/${model}:generateContent?key=${config.apiKey}`
    try {
      const response = await axios.post(url, body, {
        headers: { 'Content-Type': 'application/json' }
      })
      return response.data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    } catch (error: unknown) {
      const msg = axios.isAxiosError(error)
        ? error.response?.data?.error?.message || error.message
        : String(error)
      throw new Error(`Gemini API error: ${msg}`)
    }
  }

  private async sendOllamaVisionMessage(
    config: AIProviderConfig,
    messages: ChatMessage[],
    images: VisionImage[],
    systemPrompt?: string,
    callbacks?: StreamCallbacks
  ): Promise<string> {
    const model = config.model || 'llama3.1'
    const baseURL = config.baseURL || 'http://localhost:11434'
    const url = `${baseURL}/api/chat`

    const formattedMessages: Array<{ role: string; content: string; images?: string[] }> = []
    if (systemPrompt) {
      formattedMessages.push({ role: 'system', content: systemPrompt })
    }
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      if (i === messages.length - 1 && msg.role === 'user' && images.length > 0) {
        formattedMessages.push({
          role: msg.role,
          content: msg.content,
          images: images.map((img) => img.data)
        })
      } else {
        formattedMessages.push({ role: msg.role, content: msg.content })
      }
    }

    if (callbacks) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: formattedMessages, stream: true })
      })

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.statusText}`)
      }

      let fullText = ''
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value, { stream: true })
          const lines = chunk.split('\n').filter(Boolean)

          for (const line of lines) {
            try {
              const parsed = JSON.parse(line)
              const token = parsed.message?.content || ''
              if (token) {
                fullText += token
                callbacks.onToken(token)
              }
            } catch {
              // Skip malformed JSON lines
            }
          }
        }
      }

      callbacks.onComplete(fullText)
      return fullText
    }

    const response = await axios.post(url, {
      model,
      messages: formattedMessages,
      stream: false
    })

    return response.data?.message?.content || ''
  }

  async testConnection(): Promise<{ success: boolean; message: string; model?: string }> {
    try {
      const configs = this.getProviderConfigs()
      if (configs.length === 0) {
        return { success: false, message: 'No API key configured. Add one in Settings.' }
      }
      const testMessages: ChatMessage[] = [
        {
          id: 'test',
          role: 'user',
          content: 'Say "Connection successful" in exactly those words.',
          timestamp: Date.now()
        }
      ]

      const response = await this.sendMessage(testMessages)
      return {
        success: true,
        message: response.trim().substring(0, 100),
        model: configs[0].model
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: msg }
    }
  }

  /**
   * Google Code Assist API (the endpoint the Gemini CLI uses) — subscription
   * sign-in with an OAuth bearer token instead of an API key.
   */
  private async sendGeminiCodeAssist(
    config: AIProviderConfig,
    messages: ChatMessage[],
    systemPrompt?: string,
    callbacks?: StreamCallbacks
  ): Promise<string> {
    const token = config.apiKey
    let project = this.oauth.getProjectId('gemini')
    const metadata = {
      ideType: 'IDE_UNSPECIFIED',
      ideVersion: '1.0',
      platform: 'PLATFORM_UNSPECIFIED',
      pluginType: 'GEMINI'
    }
    const headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
      'x-goog-api-client': 'agentic-browser/1.0'
    }

    // one-time onboarding: resolve the user's cloud companion project
    if (!project) {
      const load = await fetch('https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist', {
        method: 'POST',
        headers,
        body: JSON.stringify({ metadata })
      })
      if (!load.ok) throw new Error('Gemini sign-in: loadCodeAssist ' + load.status)
      const data = (await load.json()) as { currentTier?: { id?: string }; cloudaicompanionProject?: string }
      let projectId = data.cloudaicompanionProject
      if (!projectId) {
        const tierId = data.currentTier?.id
        if (!tierId) throw new Error('Gemini sign-in: no tier available for this account')
        for (let i = 0; i < 10; i++) {
          const onb = await fetch('https://cloudcode-pa.googleapis.com/v1internal:onboardUser', {
            method: 'POST',
            headers,
            body: JSON.stringify({ tierId, metadata })
          })
          if (!onb.ok) throw new Error('Gemini sign-in: onboardUser ' + onb.status)
          const od = (await onb.json()) as { done?: boolean; cloudaicompanionProject?: string }
          if (od.done && od.cloudaicompanionProject) { projectId = od.cloudaicompanionProject; break }
          await new Promise((r) => setTimeout(r, 1200))
        }
        if (!projectId) throw new Error('Gemini sign-in: onboarding did not complete')
      }
      project = projectId
      this.oauth.setProjectId('gemini', projectId)
    }

    const model = config.model || 'gemini-2.5-flash'
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
    const body = {
      model,
      project,
      request: {
        contents,
        ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
        generationConfig: { maxOutputTokens: 4096 }
      }
    }

    const res = await fetch('https://cloudcode-pa.googleapis.com/v1internal:generateContent', {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    })
    if (!res.ok) {
      throw new Error(`Gemini API ${res.status}: ${(await res.text()).substring(0, 300)}`)
    }
    const data = (await res.json()) as {
      response?: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
    }
    const text = (data.response?.candidates || [])
      .flatMap((cand) => (cand.content?.parts || []).map((p) => p.text || ''))
      .join('')
    if (callbacks) {
      callbacks.onToken(text)
      callbacks.onComplete(text)
    }
    return text
  }

  /**
   * Gemini Web provider — talks to the public StreamGenerate endpoint of
   * gemini.google.com exactly like gemini-web2api: anonymous access for text
   * generation, model selection via the MODE_CATEGORY slot [79]. Uses
   * Chromium's network stack (net.fetch) so redirect chains and cookies work.
   */
  private cachedGeminiBl = ''

  private async geminiFetchBl(): Promise<string> {
    if (this.cachedGeminiBl) return this.cachedGeminiBl
    try {
      const res = await net.fetch('https://gemini.google.com/app', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      })
      const html = await res.text()
      const m = html.match(/boq_assistant-bard-web-server_\d+\.\d+_p\d+/)
      if (m) {
        this.cachedGeminiBl = m[0]
        return m[0]
      }
    } catch { /* fall back to hardcoded bl */ }
    this.cachedGeminiBl = 'boq_assistant-bard-web-server_20260716.08_p0'
    return this.cachedGeminiBl
  }

  private async geminiEvaluate<T = unknown>(expression: string): Promise<T> {
    const ses = electronSession.defaultSession
    const res = await ses.fetch('https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=' + this.cachedGeminiBl + '&hl=en&rt=c', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://gemini.google.com',
        'Referer': 'https://gemini.google.com/app',
        'X-Same-Domain': '1',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: expression
    })
    return (await res.text()) as unknown as T
  }

  private extractGeminiWebText(raw: string): string {
    if (/BardErrorInfo\s*\[(\d+)\]/.test(raw)) {
      throw new Error('Gemini upstream rejected the request')
    }
    const texts: string[] = []
    for (const line of raw.split('\n')) {
      if (!line.includes('"wrb.fr"') || line.length < 200) continue
      try {
        const arr = JSON.parse(line) as unknown[]
        const outer = arr as Array<unknown>
        const first = outer[0] as Array<unknown>
        const innerStr = first?.[2]
        if (!innerStr || typeof innerStr !== 'string' || innerStr.length < 50) continue
        const inner = JSON.parse(innerStr) as Array<unknown>
        if (Array.isArray(inner) && inner.length > 4 && inner[4]) {
          for (const part of inner[4] as Array<unknown>) {
            if (Array.isArray(part) && part.length > 1 && part[1]) {
              if (Array.isArray(part[1])) {
                for (const t of part[1]) {
                  if (typeof t === 'string' && t.length > 0) texts.push(t)
                }
              }
            }
          }
        }
      } catch { /* skip malformed line */ }
    }
    for (let i = texts.length - 1; i >= 0; i--) {
      if (texts[i].trim()) return texts[i].replace(/```(?:python|javascript|text)\?code_(?:reference|stdout)&code_event_index=\d+\n[\s\S]*?```\n?/g, '').trim()
    }
    return ''
  }

  private async sendGeminiWeb(
    config: AIProviderConfig,
    messages: ChatMessage[],
    systemPrompt?: string,
    callbacks?: StreamCallbacks
  ): Promise<string> {
    // model -> MODE_CATEGORY slot values (1=flash, 2=thinking, 3=pro, 4=auto, 6=lite)
    const modelMap: Record<string, { mode: number; think: number }> = {
      'gemini-web-flash': { mode: 1, think: 4 },
      'gemini-web-thinking': { mode: 2, think: 0 },
      'gemini-web-pro': { mode: 3, think: 4 },
      'gemini-web-auto': { mode: 4, think: 4 }
    }
    const chosen = modelMap[config.model || ''] || modelMap['gemini-web-flash']

    // flatten the conversation into one web prompt (web UI is single-turn)
    const convo = messages
      .filter((m) => m.role !== 'system')
      .map((m) => (m.role === 'user' ? 'User: ' + m.content : 'Assistant: ' + m.content))
      .join('\n\n')
    const prompt = (systemPrompt ? systemPrompt + '\n\n' : '') + convo

    await this.geminiFetchBl() // warm the build-label cache used in the URL
    const inner: unknown[] = new Array(80).fill(null)
    inner[0] = [prompt, 0, null, null, null, null, 0]
    inner[1] = ['en']
    inner[2] = ['', '', '', null, null, null, null, null, null, '']
    inner[6] = [0]
    inner[7] = 1
    inner[10] = 1
    inner[11] = 0
    inner[17] = [[chosen.think]]
    inner[18] = 0
    inner[27] = 1
    inner[30] = [4]
    inner[41] = [2]
    inner[53] = 0
    inner[59] = crypto.randomUUID()
    inner[79] = chosen.mode

    const body = 'f.req=' + encodeURIComponent(JSON.stringify([null, JSON.stringify(inner)]))

    let raw = ''
    for (let attempt = 0; attempt < 3; attempt++) {
      raw = (await this.geminiEvaluate(body)) as unknown as string
      if (raw && raw.length > 0) break
      // refresh bl on 405-ish stale responses and retry
      this.cachedGeminiBl = ''
      await this.geminiFetchBl()
      await new Promise((r) => setTimeout(r, 1000))
    }
    if (!raw) throw new Error('Gemini Web returned an empty response after retries')

    const text = this.extractGeminiWebText(raw)
    if (!text) throw new Error('Gemini Web response could not be parsed (page protocol may have changed)')
    if (callbacks) {
      callbacks.onToken(text)
      callbacks.onComplete(text)
    }
    return text
  }
}
