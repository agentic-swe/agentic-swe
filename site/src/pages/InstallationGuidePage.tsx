import { useEffect, useMemo } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { MarkdownBody } from '../docs/MarkdownBody'

const TAB_IDS = ['overview', 'claude', 'cursor', 'codex', 'opencode', 'antigravity'] as const

type InstallGuideTabId = (typeof TAB_IDS)[number]

const TAB_LABELS: Record<InstallGuideTabId, string> = {
  overview: 'Overview',
  claude: 'Claude Code',
  cursor: 'Cursor',
  codex: 'Codex',
  opencode: 'OpenCode',
  antigravity: 'Antigravity',
}

const TAB_PATH: Record<InstallGuideTabId, string> = {
  overview: '../content/docs/install-guide/overview.md',
  claude: '../content/docs/install-guide/claude.md',
  cursor: '../content/docs/install-guide/cursor.md',
  codex: '../content/docs/install-guide/codex.md',
  opencode: '../content/docs/install-guide/opencode.md',
  antigravity: '../content/docs/install-guide/antigravity.md',
}

const rawInstallGuide = import.meta.glob<string>('../content/docs/install-guide/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

function tabFromHash(hash: string): InstallGuideTabId {
  const h = hash.replace(/^#/, '').toLowerCase()
  if ((TAB_IDS as readonly string[]).includes(h)) {
    return h as InstallGuideTabId
  }
  return 'overview'
}

function markdownForTab(tab: InstallGuideTabId): string {
  const key = TAB_PATH[tab]
  const body = rawInstallGuide[key]
  if (typeof body !== 'string') {
    throw new Error(`Missing install guide markdown: ${key}`)
  }
  return body
}

export function InstallationGuidePage() {
  const location = useLocation()
  const navigate = useNavigate()

  const activeTab = useMemo(() => tabFromHash(location.hash), [location.hash])

  useEffect(() => {
    document.title = 'Installation Guide · Agentic SWE'
    return () => {
      document.title = 'Agentic SWE — Autonomous Software Engineering Pipeline'
    }
  }, [])

  const selectTab = (id: InstallGuideTabId) => {
    navigate({ pathname: '/docs/installation', hash: id }, { replace: true })
  }

  const markdown = useMemo(() => markdownForTab(activeTab), [activeTab])

  return (
    <main className="page-main reveal visible doc-markdown-root install-guide-page">
      <p className="section-label">// docs</p>
      <nav className="doc-breadcrumb" aria-label="Breadcrumb">
        <Link to="/documentation">Documentation</Link>
        <span aria-hidden="true"> / </span>
        <span>Installation Guide</span>
      </nav>

      <h1>Installation Guide</h1>
      <p className="install-guide-intro">
        Prerequisites, migration, and uninstall are under <strong>Overview</strong>. Pick a runtime for full install
        steps, layout notes, and links to Usage and troubleshooting.
      </p>

      <div className="install-guide-tabs-wrap">
        <div className="install-guide-tabs" role="tablist" aria-label="Installation by runtime">
          {TAB_IDS.map((id) => {
            const selected = activeTab === id
            return (
              <button
                key={id}
                type="button"
                role="tab"
                id={`install-tab-${id}`}
                aria-selected={selected}
                aria-controls={`install-panel-${id}`}
                tabIndex={selected ? 0 : -1}
                className={`install-guide-tab${selected ? ' install-guide-tab--active' : ''}`}
                onClick={() => selectTab(id)}
              >
                {TAB_LABELS[id]}
              </button>
            )
          })}
        </div>
      </div>

      <div
        className="install-guide-panel"
        role="tabpanel"
        id={`install-panel-${activeTab}`}
        aria-labelledby={`install-tab-${activeTab}`}
      >
        <MarkdownBody key={activeTab} markdown={markdown} />
      </div>

      <div className="doc-see-also">
        <strong>More</strong> — <Link to="/documentation">All docs</Link> · <Link to="/support">Support</Link>
      </div>
    </main>
  )
}
