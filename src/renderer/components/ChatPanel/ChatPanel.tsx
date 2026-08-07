import React, { useState, useRef, useEffect } from 'react'
import { FileText, BookOpen, Trash2, ArrowUp, Camera } from 'lucide-react'
import { ChatMessage } from '@shared/types'

export function ChatPanel(): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  useEffect(() => {
    const unsubStream = window.api.chat.onStream((token) => {
      setStreamingText((prev) => prev + token)
    })

    const unsubResponse = window.api.chat.onResponse((fullText) => {
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: fullText,
        timestamp: Date.now()
      }
      setMessages((prev) => [...prev, assistantMsg])
      setStreamingText('')
      setIsStreaming(false)
    })

    return () => {
      unsubStream()
      unsubResponse()
    }
  }, [])

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isStreaming) return

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: Date.now()
    }

    const updatedMessages = [...messages, userMsg]
    setMessages(updatedMessages)
    setInput('')
    setIsStreaming(true)
    setStreamingText('')

    try {
      await window.api.chat.send(updatedMessages)
    } catch (error) {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'system',
        content: `Error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now()
      }
      setMessages((prev) => [...prev, errorMsg])
      setIsStreaming(false)
      setStreamingText('')
    }
  }

  const pushAssistantMessage = (content: string) => {
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: 'assistant', content, timestamp: Date.now() }
    ])
  }

  const handleSummarize = async () => {
    setIsStreaming(true)
    setStreamingText('')
    try {
      pushAssistantMessage(await window.api.chat.summarize())
    } catch (error) {
      console.error('Summarize failed:', error)
    }
    setIsStreaming(false)
    setStreamingText('')
  }

  const handleExplain = async () => {
    setIsStreaming(true)
    setStreamingText('')
    try {
      pushAssistantMessage(await window.api.chat.explain())
    } catch (error) {
      console.error('Explain failed:', error)
    }
    setIsStreaming(false)
    setStreamingText('')
  }

  const handleVisionAsk = async () => {
    if (!input.trim() || isStreaming) return

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: Date.now()
    }

    const updatedMessages = [...messages, userMsg]
    setMessages(updatedMessages)
    setInput('')
    setIsStreaming(true)
    setStreamingText('')

    try {
      await window.api.chat.vision(userMsg.content)
    } catch (error) {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'system',
        content: `Error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now()
      }
      setMessages((prev) => [...prev, errorMsg])
      setIsStreaming(false)
      setStreamingText('')
    }
  }

  const actionBtn =
    'flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border border-line text-muted hover:text-cream hover:border-accent/50 transition-colors'

  return (
    <>
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-line flex-shrink-0">
        <button onClick={handleSummarize} disabled={isStreaming} className={actionBtn} title="Summarize current page">
          <FileText size={12} /> Summarize
        </button>
        <button onClick={handleExplain} disabled={isStreaming} className={actionBtn} title="Explain selected text">
          <BookOpen size={12} /> Explain
        </button>
        <button onClick={handleVisionAsk} disabled={isStreaming || !input.trim()} className={actionBtn} title="Screenshot page and ask with vision AI">
          <Camera size={12} /> Screenshot & Ask
        </button>
        <button
          onClick={() => {
            setMessages([])
            setStreamingText('')
          }}
          className="ml-auto p-1.5 rounded-md text-muted hover:text-red-400 transition-colors"
          title="Clear chat"
        >
          <Trash2 size={13} />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && !isStreaming && (
          <div className="mt-10 text-center px-6">
            <div className="term-label mb-3">// CHAT MODE</div>
            <p className="text-sm text-muted">Ask anything about the current page.</p>
            <p className="text-xs text-muted/60 mt-1 font-mono">or hit “summarize” for the gist</p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[88%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-accent text-ink rounded-br-sm'
                  : msg.role === 'system'
                    ? 'bg-red-500/10 text-red-300 border border-red-500/30'
                    : 'bg-panel-2 text-cream rounded-bl-sm border border-line/60'
              }`}
            >
              <div className="whitespace-pre-wrap break-words">{msg.content}</div>
            </div>
          </div>
        ))}

        {isStreaming && streamingText && (
          <div className="flex justify-start">
            <div className="max-w-[88%] rounded-xl rounded-bl-sm px-3.5 py-2.5 text-sm bg-panel-2 text-cream border border-line/60">
              <div className="whitespace-pre-wrap break-words">
                {streamingText}
                <span className="cursor-blink text-accent">▌</span>
              </div>
            </div>
          </div>
        )}

        {isStreaming && !streamingText && (
          <div className="flex justify-start">
            <div className="rounded-xl px-3.5 py-2.5 text-sm bg-panel-2 text-muted border border-line/60">
              <span className="cursor-blink">thinking…</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSend} className="px-3 py-3 border-t border-line flex-shrink-0">
        <div className="flex items-end gap-2 bg-panel-2 border border-line rounded-xl px-3 py-2 focus-within:border-accent/60 transition-colors">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about this page…"
            disabled={isStreaming}
            className="flex-1 bg-transparent outline-none text-sm text-cream placeholder-muted/60 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isStreaming || !input.trim()}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-accent text-ink
                       hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </form>
    </>
  )
}
