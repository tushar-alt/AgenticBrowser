import React, { useState, useEffect } from 'react'
import { Download, X, Trash2, CheckCircle, AlertCircle, Clock } from 'lucide-react'
import { DownloadItem } from '@shared/types'

interface DownloadsPanelProps {
  isOpen: boolean
  onClose: () => void
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function getStatusIcon(status: DownloadItem['status']) {
  switch (status) {
    case 'completed':
      return <CheckCircle className="w-4 h-4 text-emerald-400" />
    case 'cancelled':
      return <X className="w-4 h-4 text-zinc-500" />
    case 'interrupted':
      return <AlertCircle className="w-4 h-4 text-red-400" />
    default:
      return <Clock className="w-4 h-4 text-amber-400 animate-pulse" />
  }
}

export function DownloadsPanel({ isOpen, onClose }: DownloadsPanelProps): React.JSX.Element | null {
  const [downloads, setDownloads] = useState<DownloadItem[]>([])

  useEffect(() => {
    if (!isOpen) return
    window.api?.downloads?.list?.().then((items) => {
      if (items) setDownloads(items)
    })
    const unsub = window.api?.downloads?.onUpdate?.((items) => {
      setDownloads(items)
    })
    return () => { unsub?.() }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed right-0 top-10 bottom-0 w-96 bg-[#0e0e10] border-l border-zinc-800 z-50 flex flex-col shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
          <Download className="w-4 h-4" />
          Downloads
          {downloads.length > 0 && (
            <span className="text-xs text-zinc-500">({downloads.length})</span>
          )}
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Download list */}
      <div className="flex-1 overflow-y-auto">
        {downloads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500 text-sm">
            <Download className="w-8 h-8 mb-2 opacity-50" />
            No downloads yet
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/50">
            {downloads.map((item) => (
              <div key={item.id} className="px-4 py-3 hover:bg-zinc-900/50 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">
                    {getStatusIcon(item.status)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-zinc-100 truncate" title={item.filename}>
                      {item.filename}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-zinc-500">
                      {item.status === 'downloading' ? (
                        <>
                          <span>{formatBytes(item.receivedBytes)} / {formatBytes(item.totalBytes)}</span>
                          <span>·</span>
                          <span>{Math.round(item.progress * 100)}%</span>
                        </>
                      ) : item.status === 'completed' ? (
                        <span>{formatBytes(item.totalBytes)} · Completed</span>
                      ) : (
                        <span className="capitalize">{item.status}</span>
                      )}
                    </div>
                    {/* Progress bar */}
                    {item.status === 'downloading' && (
                      <div className="mt-2 h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-500 transition-all duration-300"
                          style={{ width: `${item.progress * 100}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      {downloads.length > 0 && (
        <div className="px-4 py-2 border-t border-zinc-800">
          <button
            onClick={() => {
              window.api?.downloads?.clear?.()
              setDownloads([])
            }}
            className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1"
          >
            <Trash2 className="w-3 h-3" />
            Clear list
          </button>
        </div>
      )}
    </div>
  )
}
