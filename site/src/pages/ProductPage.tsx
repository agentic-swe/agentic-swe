import { Link } from 'react-router-dom'

export function ProductPage() {
  return (
    <main className="page-main reveal visible">
      <p className="section-label">// positioning</p>
      <h1>Product</h1>
      <p>
        Agentic SWE is a <strong>workflow pack</strong> for Claude Code (and compatible hosts): installable markdown —
        policies, phases, agents, templates — that runs in <strong>your</strong> repository. There is <strong>no</strong>{' '}
        hosted SaaS runtime in this repo; the runtime is your editor session plus git and CI. The <strong>Hypervisor</strong>{' '}
        is the primary chat that follows the root policy.
      </p>

      <h2>Who it’s for</h2>
      <ul>
        <li>
          <strong>Primary:</strong> Engineering teams (~2–20) already using or adopting Claude Code who want phased
          workflows, budgets, and human gates.
        </li>
        <li>
          <strong>Secondary:</strong> Senior ICs who want the same structure for personal or small projects.
        </li>
      </ul>

      <h2>Hero message</h2>
      <p className="hero-quote">
        Ship AI-assisted changes with traceable state, iteration budgets, and human gates — not unbounded agent loops.
      </p>
      <p>Lead with governance, safety rails, and review-friendly artifacts — not “more agents.”</p>

      <h2>Differentiators</h2>
      <ol>
        <li>
          <strong>Runaway work</strong> — Budgets, <code>ambiguity-wait</code> / <code>approval-wait</code>, and
          escalations address fear of uncontrolled automation.
        </li>
        <li>
          <strong>Dev workflow product</strong> — Same bucket as team conventions and editor rules: workflow + safety
          for agent-assisted coding.
        </li>
        <li>
          <strong>Extensibility</strong> — Optional domain subagents and custom packs without changing the core state
          machine philosophy.
        </li>
      </ol>

      <h2>What we don’t claim here</h2>
      <p>
        The open pack does not imply a multi-tenant cloud that runs your pipeline for you. Anything beyond the markdown
        pack (e.g. commercial tiers) belongs in separate product docs such as{' '}
        <Link to="/docs/pro">Agentic SWE Pro</Link> if present.
      </p>

      <div className="doc-see-also">
        <strong>See also</strong> — <Link to="/docs/product-positioning">Product positioning</Link> ·{' '}
        <Link to="/docs/licensing">Licensing</Link> · <Link to="/docs/distribution">Distribution</Link>
      </div>
    </main>
  )
}
