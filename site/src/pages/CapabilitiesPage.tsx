import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'

const CARDS = [
  {
    icon: '\u2699',
    iconClass: 'cyan' as const,
    title: 'Zero runtime code',
    body: (
      <>
        The pipeline is markdown at the plugin root (<code style={{ fontSize: '0.85em' }}>{'${CLAUDE_PLUGIN_ROOT}/'}</code>{' '}
        — e.g. <code style={{ fontSize: '0.85em' }}>phases/</code>, <code style={{ fontSize: '0.85em' }}>commands/</code>)
        plus the root Hypervisor policy file (<code style={{ fontSize: '0.85em' }}>CLAUDE.md</code>). The host (e.g. Claude
        Code) executes it. Optional local tools like the brainstorm visual server are
        opt-in — not required to run <code style={{ fontSize: '0.85em' }}>/work</code>.
      </>
    ),
  },
  {
    icon: '\u25C6',
    iconClass: 'violet' as const,
    title: 'Evidence-based decisions',
    body: <>Every phase output follows a four-point evidence standard: observed, inferred, evidence, uncertain. No guessing.</>,
  },
  {
    icon: '\u2605',
    iconClass: 'amber' as const,
    title: '135+ specialized agents',
    body: (
      <>
        Auto-selected based on your codebase. Python, TypeScript, Rust, Kubernetes, security, ML — agents that know the
        domain.
      </>
    ),
  },
  {
    icon: '\u26A1',
    iconClass: 'cyan' as const,
    title: 'Human gates built in',
    body: <>The pipeline stops at ambiguity, approval, and escalation points. You stay in control of what ships.</>,
  },
  {
    icon: '\u2699',
    iconClass: 'violet' as const,
    title: 'Multi-agent review',
    body: (
      <>
        Complex designs get a three-agent panel review: architect, security, and adversarial — running in parallel.
      </>
    ),
  },
  {
    icon: '\u26A1',
    iconClass: 'amber' as const,
    title: 'Track-aware routing',
    body: (
      <>
        Lean, standard, and rigorous tracks share one state machine;{' '}
        <code style={{ fontSize: '0.85em' }}>lean-track-check</code> records{' '}
        <code style={{ fontSize: '0.85em' }}>pipeline.track</code> so phases and budgets match risk.
      </>
    ),
  },
  {
    icon: '\u25C9',
    iconClass: 'cyan' as const,
    title: 'Hypervisor session',
    body: (
      <>
        The primary chat session is the <strong>Hypervisor</strong>: it carries{' '}
        <code style={{ fontSize: '0.85em' }}>state.json</code>, runs mandatory{' '}
        <code style={{ fontSize: '0.85em' }}>/check</code> steps, delegates to core agents and subagents, and stays
        accountable — not a separate hosted service.
      </>
    ),
  },
]

export function CapabilitiesPage() {
  return (
    <>
      <section id="overview">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.45 }}
        >
          <div className="section-label">// capabilities</div>
          <h2>What makes it different</h2>
        </motion.div>
        <div className="features-grid">
          {CARDS.map((card, i) => (
            <motion.div
              key={card.title}
              className="feature-card"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.15 }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
              whileHover={{ y: -4, borderColor: 'var(--cyan-dim)' }}
            >
              <div className={`feature-icon ${card.iconClass}`}>{card.icon}</div>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section id="platforms">
        <motion.div
          className="platforms-section"
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.45 }}
        >
          <div className="section-label">// multi-platform</div>
          <h2>Same pack, your editor or CLI</h2>
          <p
            className="section-desc"
            style={{ marginLeft: 'auto', marginRight: 'auto', maxWidth: '720px' }}
          >
            Install once into the repo; the <strong>Hypervisor</strong> policy and{' '}
            <code style={{ fontSize: '0.9em' }}>{'${CLAUDE_PLUGIN_ROOT}/'}</code> pipeline tree work across hosts.{' '}
            <strong>Claude Code</strong> is
            the primary path; Cursor, Codex, OpenCode, and Gemini CLI are supported via the bundled plugin / extension
            hooks — see <Link to="/docs/multi-platform-support">multi-platform support</Link>.
          </p>
          <div className="platforms-list">
            <span>Claude Code</span>
            <span>Cursor</span>
            <span>Codex</span>
            <span>OpenCode</span>
            <span>Gemini CLI</span>
          </div>
        </motion.div>
      </section>
    </>
  )
}
