import { motion, useReducedMotionConfig } from 'framer-motion'
import { useMemo, useState } from 'react'
import { InstallPlatformModal, type InstallPlatformId } from './InstallPlatformModal'

const INSTALL_DOC_PATHS: Record<InstallPlatformId, string> = {
  claude: '../content/docs/claude-code-plugin.md',
  cursor: '../content/docs/cursor-plugin.md',
  codex: '../content/docs/README.codex.md',
  opencode: '../content/docs/README.opencode.md',
  antigravity: '../content/docs/antigravity.md',
}

const rawInstallDocs = import.meta.glob<string>(
  [
    '../content/docs/claude-code-plugin.md',
    '../content/docs/cursor-plugin.md',
    '../content/docs/README.codex.md',
    '../content/docs/README.opencode.md',
    '../content/docs/antigravity.md',
  ],
  { query: '?raw', import: 'default', eager: true },
)

const PLATFORMS: { id: InstallPlatformId; label: string; hint?: string }[] = [
  { id: 'claude', label: 'Claude', hint: 'Claude Code plugin' },
  { id: 'cursor', label: 'Cursor', hint: 'Local plugin + merge' },
  { id: 'codex', label: 'Codex', hint: 'AGENTS.md + symlink' },
  { id: 'opencode', label: 'OpenCode', hint: '.opencode plugin' },
  { id: 'antigravity', label: 'Antigravity', hint: 'Google IDE' },
]

function installMarkdown(id: InstallPlatformId): string {
  const p = INSTALL_DOC_PATHS[id]
  const v = rawInstallDocs[p]
  if (typeof v !== 'string') {
    throw new Error(`Missing install doc bundle for ${p}`)
  }
  return v
}

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.11, delayChildren: 0.08 },
  },
}

const item = {
  hidden: { opacity: 0, y: 28 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] as const },
  },
}

export function Hero() {
  const hideOrbit = useReducedMotionConfig() === true
  const [modalId, setModalId] = useState<InstallPlatformId | null>(null)

  const modalTitle = useMemo(() => {
    if (!modalId) return ''
    const row = PLATFORMS.find((x) => x.id === modalId)
    return row ? `Install · ${row.label}` : ''
  }, [modalId])

  const modalMarkdown = useMemo(() => {
    if (!modalId) return ''
    return installMarkdown(modalId)
  }, [modalId])

  return (
    <section className="hero hero--motion">
      {!hideOrbit && (
        <div className="hero-orbit" aria-hidden>
          <motion.span
            className="hero-orbit__ring hero-orbit__ring--outer"
            animate={{ rotate: 360 }}
            transition={{ duration: 120, repeat: Infinity, ease: 'linear' }}
          />
          <motion.span
            className="hero-orbit__ring hero-orbit__ring--inner"
            animate={{ rotate: -360 }}
            transition={{ duration: 90, repeat: Infinity, ease: 'linear' }}
          />
        </div>
      )}

      <motion.div
        className="hero-inner"
        variants={container}
        initial="hidden"
        animate="show"
      >
        <motion.div className="hero-badge" variants={item}>
          <span className="dot" />
          Hypervisor policy · Pure markdown · No cloud runtime
        </motion.div>
        <motion.h1 variants={item} className="hero-headline">
          <span className="hero-headline-primary">Autonomous SWE</span>
          <br />
          <span className="gradient-text hero-headline-tagline">
          policy-driven autonomous engineering
          </span>
        </motion.h1>
        <motion.p variants={item} className="hero-lead">
          A state-machine pipeline with <strong>three tracks</strong> (lean, standard, rigorous),{' '}
          <strong>human gates</strong>, and evidence-backed artifacts. Your primary session follows the{' '}
          <strong>Hypervisor</strong> policy in the repo root — plus <strong>135+</strong> auto-selected
          specialists. Zero in-repo runtime: policies, phases, and agents are markdown.
        </motion.p>

        <motion.div className="hero-install" variants={item}>
          <div className="section-label">// installation</div>
          <div className="hero-install-grid" role="list">
            {PLATFORMS.map((p) => (
              <motion.button
                key={p.id}
                type="button"
                className="hero-install-tile"
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setModalId(p.id)}
                role="listitem"
              >
                <span className="hero-install-tile__name">{p.label}</span>
                {p.hint ? <span className="hero-install-tile__hint">{p.hint}</span> : null}
              </motion.button>
            ))}
          </div>
        </motion.div>
      </motion.div>

      <InstallPlatformModal
        open={modalId !== null}
        title={modalTitle}
        markdown={modalMarkdown}
        onClose={() => setModalId(null)}
      />
    </section>
  )
}
