import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { DOC_REGISTRY, type DocSlug } from '../docs/registry'

type HubExtraCard = { to: string; title: string; description: string }

const GROUPS: { label: string; slugs: DocSlug[]; extraCards?: HubExtraCard[] }[] = [
  {
    label: 'Get started',
    slugs: [
      'installation',
      'golden-path',
      'host-support-tiers',
      'multi-platform-support',
      'usage',
      'claude-code-plugin',
      'troubleshooting',
    ],
  },
  {
    label: 'Reference',
    slugs: [
      'check-commands',
      'durable-memory',
      'examples',
      'subagent-catalog',
      'distribution',
      'release-checklist',
    ],
  },
  {
    label: 'Product and legal',
    slugs: ['product-positioning', 'adoption-one-pager', 'licensing', 'privacy'],
    extraCards: [
      {
        to: '/support',
        title: 'Support',
        description: 'Quick fixes, plugin validation, migrations, and where to get help.',
      },
    ],
  },
  {
    label: 'Other hosts',
    slugs: ['cursor-plugin', 'opencode', 'codex', 'antigravity'],
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
        Browse structured pages below (same content as the repo markdown, rendered in-site). New users:{' '}
        <Link to="/docs/golden-path">Golden path</Link> (~15 minutes), then <Link to="/docs/installation">Installation</Link>,{' '}
        <Link to="/docs/usage">Usage</Link>, <Link to="/docs/durable-memory">Durable memory</Link>, and{' '}
        <Link to="/docs/multi-platform-support">Multi-platform support</Link>.
      </p>

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
            {group.extraCards?.map((card) => (
              <motion.div key={card.to} whileHover={{ y: -4 }} transition={{ duration: 0.2 }}>
                <Link className="hub-card" to={card.to}>
                  <h3>{card.title}</h3>
                  <p>{card.description}</p>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}
