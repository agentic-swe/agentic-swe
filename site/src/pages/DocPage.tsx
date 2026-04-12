import { useEffect, useMemo } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { DOC_REGISTRY, isDocSlug, type DocSlug } from '../docs/registry'
import { MarkdownBody } from '../docs/MarkdownBody'

const rawModules = import.meta.glob<string>('../content/docs/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

function markdownForSlug(slug: DocSlug): string | undefined {
  const key = DOC_REGISTRY[slug].globKey
  return rawModules[key]
}

export function DocPage() {
  const { slug } = useParams<{ slug: string }>()
  const valid = slug && isDocSlug(slug)

  const meta = valid ? DOC_REGISTRY[slug as DocSlug] : null
  const markdown = valid ? markdownForSlug(slug as DocSlug) : undefined

  useEffect(() => {
    if (meta) {
      document.title = `${meta.title} · Agentic SWE`
    }
    return () => {
      document.title = 'Agentic SWE — Autonomous Software Engineering Pipeline'
    }
  }, [meta])

  const body = useMemo(() => {
    if (!valid || markdown === undefined) return null
    return <MarkdownBody markdown={markdown} />
  }, [valid, markdown])

  if (!slug || !valid) {
    return <Navigate to="/documentation" replace />
  }

  if (markdown === undefined) {
    return (
      <main className="page-main reveal visible">
        <p className="section-label">// docs</p>
        <h1>Missing document</h1>
        <p>
          No bundled content for <code>{slug}</code>.{' '}
          <Link to="/documentation">Back to documentation</Link>
        </p>
      </main>
    )
  }

  return (
    <main className="page-main reveal visible doc-markdown-root">
      <p className="section-label">// docs</p>
      <nav className="doc-breadcrumb" aria-label="Breadcrumb">
        <Link to="/documentation">Documentation</Link>
        <span aria-hidden="true"> / </span>
        <span>{meta!.title}</span>
      </nav>
      {body}
      <div className="doc-see-also">
        <strong>More</strong> — <Link to="/documentation">All docs</Link> · <Link to="/support">Support</Link>
      </div>
    </main>
  )
}
