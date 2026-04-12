import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { MarkdownBody } from '../docs/MarkdownBody'

export type InstallPlatformId = 'claude' | 'cursor' | 'codex' | 'opencode' | 'antigravity'

type InstallPlatformModalProps = {
  open: boolean
  title: string
  markdown: string
  onClose: () => void
}

export function InstallPlatformModal({ open, title, markdown, onClose }: InstallPlatformModalProps) {
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="install-modal-root" role="presentation">
      <button type="button" className="install-modal-backdrop" aria-label="Close" onClick={onClose} />
      <div
        className="install-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="install-modal-header">
          <h2 id={titleId} className="install-modal-title">
            {title}
          </h2>
          <button ref={closeRef} type="button" className="install-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="install-modal-body page-main">
          <MarkdownBody markdown={markdown} />
        </div>
      </div>
    </div>,
    document.body,
  )
}
