import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Hero } from '../components/Hero'
import { PipelineViz } from '../components/PipelineViz'

const sectionFade = {
  hidden: { opacity: 0, y: 18 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: 'easeOut' as const },
  },
}

const AGENT_ROWS = [
  ['Core Development', '10'],
  ['Language Specialists', '29'],
  ['Infrastructure', '16'],
  ['Quality & Security', '14'],
  ['Data & AI', '13'],
  ['Developer Experience', '13'],
  ['Specialized Domains', '12'],
  ['Business & Product', '11'],
  ['Meta & Orchestration', '10'],
  ['Research & Analysis', '7'],
] as const

const COMMANDS: [string, string][] = [
  ['/work <task>', 'Start a new task — auto-routes lean, standard, or rigorous track'],
  ['/work <id>', 'Resume paused work by ID'],
  ['/plan-only <task>', 'Feasibility and design without implementing'],
  ['/brainstorm', 'Design-first exploration; optional visual server'],
  ['/write-plan [id]', 'Refine implementation plan — no coding'],
  ['/execute-plan [id]', 'Run the plan via implementation paths'],
  ['/author-pipeline', 'Safe checklist to extend phases and commands'],
  ['/evaluate-work <id>', 'Work item health and artifact status'],
  ['/subagent', 'Browse, search, and invoke specialists'],
  ['/repo-scan', 'Structured codebase snapshot'],
  ['/test-runner [scope]', 'Detect and run tests'],
  ['/lint [scope]', 'Linters in check mode'],
  ['/check budget', 'Before phases — budgets intact'],
  ['/check transition', 'Before state changes — edge allowed for track'],
  ['/check artifacts', 'Before transition — required files present'],
]

export function HomePage() {
  return (
    <>
      <Hero />

      <section id="pipeline" className="pipeline-section">
        <motion.div
          variants={sectionFade}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.25 }}
        >
          <div className="section-label">// how it works</div>
          <h2>Three tracks, one pipeline</h2>
          <p
            className="section-desc"
            style={{ marginLeft: 'auto', marginRight: 'auto', maxWidth: '720px' }}
          >
            After feasibility, <code style={{ fontSize: '0.9em' }}>lean-track-check</code> sets{' '}
            <code style={{ fontSize: '0.9em' }}>pipeline.track</code> in{' '}
            <code style={{ fontSize: '0.9em' }}>state.json</code>: <strong>lean</strong> (minimal),{' '}
            <strong>standard</strong> (design + tests, skips design panel and separate code-review phase), or{' '}
            <strong>rigorous</strong> (full panel, design-review, code-review, permissions). The{' '}
            <strong>Hypervisor</strong> (primary session) owns transitions and gates per the published policy.
          </p>
        </motion.div>

        <PipelineViz />

        <motion.p
          className="pipeline-note"
          variants={sectionFade}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.2 }}
        >
          <span style={{ color: 'var(--accent-human)' }}>&#9632;</span> Human gates stop the pipeline for your
          review. Nothing ships without approval.
          <br />
          <span style={{ color: 'var(--cyan)' }}>&#9632;</span> Transition edges live in{' '}
          <code style={{ fontSize: '0.85em' }}>{'${CLAUDE_PLUGIN_ROOT}/state-machine.json'}</code> and match the fenced graph in the
          root Hypervisor policy (verified in CI).
        </motion.p>
      </section>

      <section id="agents">
        <motion.div
          variants={sectionFade}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.2 }}
        >
          <div className="section-label">// subagents</div>
          <h2>135+ agents across 10 categories</h2>
          <p className="section-desc">
            Automatically selected during pipeline execution. Agents can also call other agents when they encounter
            domain-specific problems.
          </p>
        </motion.div>
        <div className="agents-grid">
          {AGENT_ROWS.map(([name, count], i) => (
            <motion.div
              key={name}
              className="agent-row"
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.15 }}
              transition={{ duration: 0.35, delay: i * 0.03 }}
              whileHover={{ borderColor: 'var(--cyan-dim)' }}
            >
              <span className="agent-name">{name}</span>
              <span className="agent-count">{count}</span>
            </motion.div>
          ))}
        </div>
      </section>

      <section id="start">
        <motion.div
          variants={sectionFade}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.25 }}
        >
          <div className="section-label">// quick start</div>
          <h2>Up and running in 3 steps</h2>
        </motion.div>
        <div className="steps">
          {[
            {
              n: '1',
              title: 'Enable the Claude Code plugin',
              body: (
                <>
                  <div className="code-block">
                    <code>
                      <span className="cmd">/plugin</span> marketplace add surajSFDC/agentic-swe
                    </code>
                  </div>
                  <div className="code-block" style={{ marginTop: '0.5rem' }}>
                    <code>
                      <span className="cmd">/plugin</span> install agentic-swe@agentic-swe-catalog
                    </code>
                  </div>
                  <p style={{ marginTop: '0.75rem', fontSize: '0.85rem', opacity: 0.75 }}>
                    Then <code style={{ fontSize: '0.8em' }}>/install</code> in your project for{' '}
                    <code style={{ fontSize: '0.8em' }}>CLAUDE.md</code> + <code style={{ fontSize: '0.8em' }}>.worklogs/</code>
                    . See the <Link to="/docs/installation">installation guide</Link>.
                  </p>
                </>
              ),
            },
            {
              n: '2',
              title: 'Open Claude Code',
              body: (
                <div className="code-block">
                  <code>
                    <span className="cmd">cd</span> /path/to/your/project && <span className="cmd">claude</span>
                  </code>
                </div>
              ),
            },
            {
              n: '3',
              title: 'Start working',
              body: (
                <div className="code-block">
                  <code>
                    <span className="cmd">/work</span> Add retry logic to the API client
                  </code>
                </div>
              ),
            },
          ].map((step, i) => (
            <motion.div
              key={step.n}
              className="step"
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{ duration: 0.45, delay: i * 0.08 }}
            >
              <span className="step-number">{step.n}</span>
              <div className="step-content">
                <h3>{step.title}</h3>
                {step.body}
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      <section id="commands">
        <motion.div
          variants={sectionFade}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.2 }}
        >
          <div className="section-label">// commands</div>
          <h2>Key commands</h2>
        </motion.div>
        <div className="commands-list">
          {COMMANDS.map(([name, desc], i) => (
            <motion.div
              key={name}
              className="cmd-row"
              initial={{ opacity: 0, x: -8 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, amount: 0.08 }}
              transition={{ duration: 0.3, delay: Math.min(i * 0.02, 0.24) }}
              whileHover={{ borderColor: 'var(--cyan-dim)', x: 2 }}
            >
              <span className="cmd-name">{name}</span>
              <span className="cmd-desc">{desc}</span>
            </motion.div>
          ))}
        </div>
      </section>
    </>
  )
}
