import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import axios from 'axios'
import { AIProviderConfig, ChatMessage, VisionImage } from '@shared/types'
import { SecureStorage } from './SecureStorage'

interface StreamCallbacks {
  onToken: (token: string) => void
  onComplete: (fullText: string) => void
  onError: (error: string) => void
}

export class AIClient {
  private secureStorage: SecureStorage
  private openaiClient: OpenAI | null = null
  private anthropicClient: Anthropic | null = null

  constructor(secureStorage: SecureStorage) {
    this.secureStorage = secureStorage
  }

  private getProviderConfig(): AIProviderConfig {
    const provider = this.secureStorage.getActiveProvider()
    const apiKey = this.secureStorage.getKey()
    const config = this.secureStorage.getConfig()

    if (!apiKey) {
      throw new Error(`No API key configured for ${provider}. Please add one in Settings.`)
    }

    return {
      provider,
      apiKey,
      baseURL: config?.baseURL,
      model: config?.model
    }
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

  private getAnthropicClient(apiKey: string): Anthropic {
    if (!this.anthropicClient || this.anthropicClient.apiKey !== apiKey) {
      this.anthropicClient = new Anthropic({ apiKey })
    }
    return this.anthropicClient
  }

  async sendMessage(
    messages: ChatMessage[],
    systemPrompt?: string,
    callbacks?: StreamCallbacks
  ): Promise<string> {
    const config = this.getProviderConfig()

    switch (config.provider) {
      case 'openai':
      case 'custom':
        return this.sendOpenAIMessage(config, messages, systemPrompt, callbacks)
      case 'anthropic':
        return this.sendAnthropicMessage(config, messages, systemPrompt, callbacks)
      case 'gemini':
        return this.sendGeminiMessage(config, messages, systemPrompt, callbacks)
      case 'ollama':
        return this.sendOllamaMessage(config, messages, systemPrompt, callbacks)
      default:
        throw new Error(`Unsupported provider: ${config.provider}`)
    }
  }

  async sendVisionMessage(
    messages: ChatMessage[],
    images: VisionImage[],
    systemPrompt?: string,
    callbacks?: StreamCallbacks
  ): Promise<string> {
    const config = this.getProviderConfig()

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
    const client = this.getAnthropicClient(config.apiKey)
    const model = config.model || 'claude-sonnet-4-20250514'

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
      })

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
    })

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
    callbacks?: StreamCallbacks
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
    const client = this.getAnthropicClient(config.apiKey)
    const model = config.model || 'claude-sonnet-4-20250514'

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
      })

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
    })

    const textBlock = response.content.find((b) => b.type === 'text')
    return textBlock ? (textBlock as Anthropic.TextBlock).text : ''
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
      const config = this.getProviderConfig()
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
        model: config.model
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: msg }
    }
  }
}
