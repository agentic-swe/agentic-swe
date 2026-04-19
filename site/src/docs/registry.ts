/**
 * Doc slugs, titles, and bundled markdown paths (see DocPage glob).
 */
export const GITHUB_REPO_MAIN = 'https://github.com/surajSFDC/agentic-swe/blob/main'

export const DOC_SLUGS = [
  'installation',
  'golden-path',
  'host-support-tiers',
  'multi-platform-support',
  'usage',
  'durable-memory',
  'troubleshooting',
  'claude-code-plugin',
  'cursor-plugin',
  'check-commands',
  'examples',
  'distribution',
  'release-checklist',
  'subagent-catalog',
  'product-positioning',
  'adoption-one-pager',
  'licensing',
  'privacy',
  'opencode',
  'codex',
  'antigravity',
] as const

export type DocSlug = (typeof DOC_SLUGS)[number]

export type DocMeta = {
  title: string
  description?: string
  /** Path relative to DocPage for import.meta.glob */
  globKey: string
}

/** Basename in content/docs → slug (for markdown link rewriting). */
export const MARKDOWN_FILE_TO_SLUG: Record<string, DocSlug> = {
  'installation.md': 'installation',
  'golden-path.md': 'golden-path',
  'host-support-tiers.md': 'host-support-tiers',
  'multi-platform-support.md': 'multi-platform-support',
  'usage.md': 'usage',
  'durable-memory.md': 'durable-memory',
  'troubleshooting.md': 'troubleshooting',
  'claude-code-plugin.md': 'claude-code-plugin',
  'cursor-plugin.md': 'cursor-plugin',
  'check-commands.md': 'check-commands',
  'examples.md': 'examples',
  'distribution.md': 'distribution',
  'release-checklist.md': 'release-checklist',
  'subagent-catalog.md': 'subagent-catalog',
  'product-positioning.md': 'product-positioning',
  'adoption-one-pager.md': 'adoption-one-pager',
  'licensing.md': 'licensing',
  'privacy.md': 'privacy',
  'README.opencode.md': 'opencode',
  'README.codex.md': 'codex',
  'antigravity.md': 'antigravity',
}

export const DOC_REGISTRY: Record<DocSlug, DocMeta> = {
  installation: {
    title: 'Installation Guide',
    description: 'Tabbed install: Overview, Claude Code, Cursor, Codex, OpenCode, Antigravity.',
    globKey: '../content/docs/installation.md',
  },
  'golden-path': {
    title: 'Golden path (15 minutes)',
    description: 'Claude Code: install → /work → .worklogs → gate; lean and standard examples.',
    globKey: '../content/docs/golden-path.md',
  },
  'host-support-tiers': {
    title: 'Host support tiers',
    description: 'What “support” means per IDE; Tier B paths for OpenCode and Antigravity.',
    globKey: '../content/docs/host-support-tiers.md',
  },
  'multi-platform-support': {
    title: 'Multi-platform support',
    description: 'Claude Code, Cursor, Codex, OpenCode, Gemini CLI — one pack, host-specific install notes.',
    globKey: '../content/docs/multi-platform-support.md',
  },
  usage: {
    title: 'Usage',
    description: 'How to run the pipeline: /work, tracks, commands, and worklogs.',
    globKey: '../content/docs/usage.md',
  },
  'durable-memory': {
    title: 'Durable memory',
    description: 'Optional local index (memory-index, memory-prime), session hook, embeddings.',
    globKey: '../content/docs/durable-memory.md',
  },
  troubleshooting: {
    title: 'Troubleshooting',
    description: 'Common failures, checks, and validation.',
    globKey: '../content/docs/troubleshooting.md',
  },
  'claude-code-plugin': {
    title: 'Claude Code plugin',
    description: 'Manifest, layout, commands vs skills, and validation.',
    globKey: '../content/docs/claude-code-plugin.md',
  },
  'cursor-plugin': {
    title: 'Cursor plugin',
    description: 'Install the .cursor-plugin manifest, hooks, target CLAUDE.md merge, and daily use.',
    globKey: '../content/docs/cursor-plugin.md',
  },
  'check-commands': {
    title: '/check commands',
    description: 'Budget, transition, and artifact enforcement.',
    globKey: '../content/docs/check-commands.md',
  },
  examples: {
    title: 'Examples',
    description: 'Sample prompts and artifact shapes.',
    globKey: '../content/docs/examples.md',
  },
  distribution: {
    title: 'Distribution',
    description: 'Marketplace, site hosting, and channels.',
    globKey: '../content/docs/distribution.md',
  },
  'release-checklist': {
    title: 'Release checklist',
    description: 'Automated checks and manual smoke before tags (maintainers).',
    globKey: '../content/docs/release-checklist.md',
  },
  'subagent-catalog': {
    title: 'Subagent catalog',
    description: 'Specialist agents and selection.',
    globKey: '../content/docs/subagent-catalog.md',
  },
  'product-positioning': {
    title: 'Product positioning',
    description: 'What the pack is (and is not).',
    globKey: '../content/docs/product-positioning.md',
  },
  'adoption-one-pager': {
    title: 'Who this is for',
    description: 'Short fit matrix for socializing; aligns with North Star without overclaiming.',
    globKey: '../content/docs/adoption-one-pager.md',
  },
  licensing: {
    title: 'Licensing',
    description: 'MIT license and how it applies to the pack.',
    globKey: '../content/docs/licensing.md',
  },
  privacy: {
    title: 'Plugin privacy',
    description: 'How the plugin relates to data, Claude Code, and GitHub (directory listings).',
    globKey: '../content/docs/privacy.md',
  },
  opencode: {
    title: 'OpenCode',
    description: 'Using the pack with OpenCode.',
    globKey: '../content/docs/README.opencode.md',
  },
  codex: {
    title: 'Codex',
    description: 'Using the pack with Codex.',
    globKey: '../content/docs/README.codex.md',
  },
  antigravity: {
    title: 'Google Antigravity',
    description: 'Using the pack with Google Antigravity: CLAUDE.md merge and pack paths.',
    globKey: '../content/docs/antigravity.md',
  },
}

export function isDocSlug(s: string): s is DocSlug {
  return (DOC_SLUGS as readonly string[]).includes(s)
}

/** Old public URLs → slug (for redirects). */
export const LEGACY_MD_TO_SLUG: Record<string, DocSlug> = {
  '/installation.md': 'installation',
  '/golden-path.md': 'golden-path',
  '/host-support-tiers.md': 'host-support-tiers',
  '/usage.md': 'usage',
  '/durable-memory.md': 'durable-memory',
  '/troubleshooting.md': 'troubleshooting',
  '/claude-code-plugin.md': 'claude-code-plugin',
  '/cursor-plugin.md': 'cursor-plugin',
  '/check-commands.md': 'check-commands',
  '/examples.md': 'examples',
  '/distribution.md': 'distribution',
  '/release-checklist.md': 'release-checklist',
  '/subagent-catalog.md': 'subagent-catalog',
  '/product-positioning.md': 'product-positioning',
  '/adoption-one-pager.md': 'adoption-one-pager',
  '/licensing.md': 'licensing',
  '/privacy.md': 'privacy',
  '/README.opencode.md': 'opencode',
  '/README.codex.md': 'codex',
  '/antigravity.md': 'antigravity',
}
