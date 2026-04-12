import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { DOC_REGISTRY, type DocSlug } from '../docs/registry'

const GROUPS: { label: string; slugs: DocSlug[] }[] = [
  {
    label: 'Get started',
    slugs: ['installation', 'multi-platform-support', 'usage', 'claude-code-plugin', 'troubleshooting'],
  },
  {
    label: 'Reference',
    slugs: ['check-commands', 'examples', 'subagent-catalog', 'distribution', 'release-checklist'],
  },
  {
    label: 'Product and legal',
    slugs: ['product-positioning', 'licensing', 'privacy'],
  },
  {
    label: 'Other hosts',
    slugs: ['opencode', 'codex'],
  },
]

export function DocumentationPage() {
  return (
    <section className="hub-section">
      <div className="section-label" style={{ textAlign: 'center' }}>
        // documentation
      </div>
      <h2>Documentation</h2>
      <p className="hub-intro">
        Browse structured pages below (same content as the repo markdown, rendered in-site). The{' '}
        <Link to="/guide">Guide</Link> is a single walkthrough; <Link to="/support">Support</Link> covers common
        failures.
      </p>
      <div className="hub-grid hub-grid--two" style={{ marginBottom: '2.5rem' }}>
        <motion.div whileHover={{ y: -4 }} transition={{ duration: 0.2 }}>
          <Link className="hub-card" to="/guide">
            <h3>Guide</h3>
            <p>One long page: install, tracks, slash commands, delegation, hosts, and sample flows.</p>
          </Link>
        </motion.div>
        <motion.div whileHover={{ y: -4 }} transition={{ duration: 0.2 }}>
          <Link className="hub-card" to="/support">
            <h3>Support</h3>
            <p>Quick fixes, plugin validation, migrations, and where to get help.</p>
          </Link>
        </motion.div>
      </div>

      {GROUPS.map((group) => (
        <div key={group.label} className="doc-hub-group">
          <h3 className="doc-hub-group-title">{group.label}</h3>
          <div className="hub-grid hub-grid--two">
            {group.slugs.map((slug) => {
              const meta = DOC_REGISTRY[slug]
              return (
                <motion.div key={slug} whileHover={{ y: -4 }} transition={{ duration: 0.2 }}>
                  <Link className="hub-card" to={`/docs/${slug}`}>
                    <h3>{meta.title}</h3>
                    <p>{meta.description ?? '—'}</p>
                  </Link>
                </motion.div>
              )
            })}
          </div>
        </div>
      ))}
    </section>
  )
}
