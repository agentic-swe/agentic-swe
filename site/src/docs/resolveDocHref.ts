import { GITHUB_REPO_MAIN, MARKDOWN_FILE_TO_SLUG } from './registry'

const basenameKey = (pathOrName: string): string => {
  const noHash = pathOrName.split('#')[0] ?? pathOrName
  const parts = noHash.split('/')
  return parts[parts.length - 1] ?? noHash
}

/**
 * Map in-doc markdown links to in-site /docs/* or GitHub main.
 */
export function resolveDocHref(href: string): { to: string; external?: boolean } {
  if (!href || href.startsWith('#')) {
    return { to: href }
  }
  if (/^https?:\/\//i.test(href) || href.startsWith('mailto:')) {
    return { to: href, external: true }
  }

  const hashIdx = href.indexOf('#')
  const hash = hashIdx >= 0 ? href.slice(hashIdx) : ''
  const pathOnly = hashIdx >= 0 ? href.slice(0, hashIdx) : href

  if (pathOnly.startsWith('../../')) {
    const rest = pathOnly.slice('../../'.length)
    return { to: `${GITHUB_REPO_MAIN}/${rest}`, external: true }
  }
  if (pathOnly.startsWith('../') && !pathOnly.startsWith('../../')) {
    const rest = pathOnly.replace(/^\.\.\//, '')
    return { to: `${GITHUB_REPO_MAIN}/${rest}`, external: true }
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
