import type { Components } from 'react-markdown'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { resolveDocHref } from './resolveDocHref'

/** In-app routes (SPA) — use React Router instead of a plain anchor. */
function isInAppPath(to: string): boolean {
  if (!to.startsWith('/') || to.startsWith('//')) return false
  const path = to.split('#')[0]?.split('?')[0] ?? to
  return (
    path === '/' ||
    path.startsWith('/docs/') ||
    path === '/guide' ||
    path === '/support' ||
    path === '/documentation' ||
    path === '/capabilities' ||
    path === '/product'
  )
}

const Anchor: Components['a'] = ({ href, children, className, id, title }) => {
  const raw = href ?? ''
  const { to, external } = resolveDocHref(raw)
  if (external) {
    return (
      <a href={to} className={className} id={id} title={title} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  }
  if (isInAppPath(to)) {
    return (
      <Link to={to} className={className} id={id} title={title}>
        {children}
      </Link>
    )
  }
  return (
    <a href={to} className={className} id={id} title={title}>
      {children}
    </a>
  )
}

const markdownComponents: Components = {
  a: Anchor,
}

type MarkdownBodyProps = {
  markdown: string
}

export function MarkdownBody({ markdown }: MarkdownBodyProps) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {markdown}
    </ReactMarkdown>
  )
}
