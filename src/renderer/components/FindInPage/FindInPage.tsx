import React, { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronUp, ChevronDown, X } from 'lucide-react'
import type { FindResult } from '@shared/types'

interface FindInPageProps {
  isOpen: boolean
  onClose: () => void
}

export function FindInPage({ isOpen, onClose }: FindInPageProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [activeMatch, setActiveMatch] = useState(0)
  const [totalMatches, setTotalMatches] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Listen for find results from the main process.
  useEffect(() => {
    if (!isOpen) return

    const unsub = window.api.find.onResult((result: FindResult) => {
      setActiveMatch(result.activeMatchOrdinal)
      setTotalMatches(result.matches)
    })

    return () => {
      unsub()
    }
  }, [isOpen])

  // Focus the input when the bar opens.
  useEffect(() => {
    if (isOpen) {
      setActiveMatch(0)
      setTotalMatches(0)
      setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 50)
    }
  }, [isOpen])

  const doFind = useCallback(
    (text: string, options?: { findNext?: boolean; forward?: boolean }) => {
      if (!text) return
      if (options?.findNext) {
        window.api.find.next(text)
      } else if (options?.forward === false) {
        window.api.find.previous(text)
      } else {
        window.api.find.start(text)
      }
    },
    []
  )

  const handleQueryChange = (value: string) => {
    setQuery(value)

    // Debounce so we don't spam findInPage on every keystroke.
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (value) {
        setActiveMatch(0)
        setTotalMatches(0)
        doFind(value)
      } else {
        window.api.find.stop()
        setActiveMatch(0)
        setTotalMatches(0)
      }
    }, 150)
  }

  const handleNext = () => {
    if (!query) return
    doFind(query, { findNext: true })
  }

  const handlePrevious = () => {
    if (!query) return
    doFind(query, { forward: false })
  }

  const handleClose = () => {
    window.api.find.stop()
    setQuery('')
    setActiveMatch(0)
    setTotalMatches(0)
    onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      handleClose()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) {
        handlePrevious()
      } else {
        handleNext()
      }
    }
  }

  if (!isOpen) return <></>

  const matchLabel =
    totalMatches > 0
      ? `${activeMatch} of ${totalMatches}`
      : query
        ? 'No results'
        : ''

  const iconBtn =
    'w-7 h-7 flex items-center justify-center rounded-md text-muted hover:text-cream hover:bg-panel-3 ' +
    'disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-muted transition-colors'

  return (
    <div className="fixed top-[43px] right-3 z-50 fade-up">
      <div
        className="flex items-center gap-1.5 h-9 bg-panel rounded-lg border border-line
                   px-2 shadow-lift"
        onKeyDown={handleKeyDown}
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Find in page…"
          className="w-52 bg-transparent text-sm text-cream placeholder-muted/60 outline-none font-mono"
        />

        {/* Match count */}
        <span
          className={`text-xs font-mono min-w-[64px] text-center ${
            totalMatches > 0 ? 'text-muted' : 'text-accent'
          }`}
        >
          {matchLabel}
        </span>

        {/* Previous */}
        <button
          onClick={handlePrevious}
          disabled={!query || totalMatches === 0}
          className={iconBtn}
          title="Previous (Shift+Enter)"
        >
          <ChevronUp size={15} />
        </button>

        {/* Next */}
        <button
          onClick={handleNext}
          disabled={!query || totalMatches === 0}
          className={iconBtn}
          title="Next (Enter)"
        >
          <ChevronDown size={15} />
        </button>

        {/* Separator */}
        <div className="w-px h-4 bg-line mx-0.5" />

        {/* Close */}
        <button onClick={handleClose} className={iconBtn} title="Close (Escape)">
          <X size={15} />
        </button>
      </div>
    </div>
  )
}
