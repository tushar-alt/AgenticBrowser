import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import axios from 'axios'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { AIProviderConfig, ChatMessage, VisionImage } from '@shared/types'
import { SecureStorage } from './SecureStorage'
import { OAuthAccounts, type OAuthKind } from './OAuthAccounts'

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
    const provider = this.secureStorage.getActiveProvider()
    const config = this.secureStorage.getConfig()
    // Subscription sign-in providers authenticate via OAuth, not stored keys.
    if (provider === 'claude-oauth' || provider === 'chatgpt-oauth') {
      if (!this.oauth.status(provider as OAuthKind).connected) return null
      return { provider, apiKey: '', model: config?.model }
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
}
