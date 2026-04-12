import { GITHUB_REPO_MAIN, MARKDOWN_FILE_TO_SLUG } from './registry'

const basenameKey = (pathOrName: string): string => {
  const noHash = pathOrName.split('#')[0] ?? pathOrName
  const parts = noHash.split('/')
  return parts[parts.length - 1] ?? noHash
}

const OWNER_REPO = 'surajSFDC/agentic-swe'

function endsWithMarkdown(path: string): boolean {
  return /\.md$/i.test(path.split('#')[0] ?? path)
}

/** Map bundled doc basenames → in-site route; unknown pack-only .md → documentation hub (never GitHub blob .md). */
function hrefForMarkdownPath(pathInRepo: string, hash: string): { to: string; external?: boolean } {
  const base = basenameKey(pathInRepo)
  const slug = MARKDOWN_FILE_TO_SLUG[base]
  if (slug) return { to: `/docs/${slug}${hash}` }
  return { to: `/documentation${hash}` }
}

/**
 * If href is our GitHub repo (or raw) pointing at a .md file, rewrite to in-site docs or /documentation.
 * Returns null when no rewrite applies.
 */
function tryRewriteOurGithubMarkdownAbsolute(href: string): { to: string; external?: boolean } | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }

  if (url.hostname === 'github.com') {
    const segs = url.pathname.split('/').filter(Boolean)
    const bi = segs.indexOf('blob')
    if (
      segs[0] !== 'surajSFDC' ||
      segs[1] !== 'agentic-swe' ||
      bi < 0 ||
      segs[bi + 1] !== 'main'
    ) {
      return null
    }
    const filePath = segs.slice(bi + 2).join('/')
    if (!endsWithMarkdown(filePath)) return null
    return hrefForMarkdownPath(filePath, url.hash)
  }

  if (url.hostname === 'raw.githubusercontent.com') {
    const m = url.pathname.match(new RegExp(`^/${OWNER_REPO}/main/(.+)$`, 'i'))
    if (!m?.[1] || !endsWithMarkdown(m[1])) return null
    return hrefForMarkdownPath(m[1], url.hash)
  }

  return null
}

function resolveRepoRelativeMarkdown(rest: string, hash: string): { to: string; external?: boolean } {
  if (!endsWithMarkdown(rest)) {
    return { to: `${GITHUB_REPO_MAIN}/${rest}${hash}`, external: true }
  }
  return hrefForMarkdownPath(rest, hash)
}

/**
 * Map in-doc markdown links to in-site /docs/*, /documentation, or non-.md GitHub blob paths.
 * Never emits a link to this repo’s GitHub **.md** blob (or raw .md); those become /docs or the hub.
 */
export function resolveDocHref(href: string): { to: string; external?: boolean } {
  if (!href || href.startsWith('#')) {
    return { to: href }
  }

  if (/^https?:\/\//i.test(href) || href.startsWith('mailto:')) {
    if (href.startsWith('mailto:')) {
      return { to: href, external: true }
    }
    const rewritten = tryRewriteOurGithubMarkdownAbsolute(href)
    if (rewritten) return rewritten
    return { to: href, external: true }
  }

  const hashIdx = href.indexOf('#')
  const hash = hashIdx >= 0 ? href.slice(hashIdx) : ''
  const pathOnly = hashIdx >= 0 ? href.slice(0, hashIdx) : href

  if (pathOnly.startsWith('../../')) {
    const rest = pathOnly.slice('../../'.length)
    return resolveRepoRelativeMarkdown(rest, hash)
  }
  if (pathOnly.startsWith('../')) {
    const rest = pathOnly.replace(/^\.\.\//, '')
    return resolveRepoRelativeMarkdown(rest, hash)
  }

  if (pathOnly.endsWith('.md')) {
    const base = basenameKey(pathOnly)
    const slug = MARKDOWN_FILE_TO_SLUG[base]
    if (slug) {
      return { to: `/docs/${slug}${hash}` }
    }
  }

  return { to: href }
}
