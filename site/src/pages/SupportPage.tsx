import { Link } from 'react-router-dom'

export function SupportPage() {
  return (
    <main className="page-main reveal visible">
      <p className="section-label">// help</p>
      <h1>Support &amp; troubleshooting</h1>

      <h2>
        Slash commands like <code>/work</code> are missing
      </h2>
      <p>
        Enable the <strong>agentic-swe</strong> plugin in Claude Code for <strong>your project</strong> (
        <code>/plugin install agentic-swe@agentic-swe-catalog</code> after adding the marketplace). Commands come from{' '}
        <code>{'${CLAUDE_PLUGIN_ROOT}/commands/'}</code>. Open Claude Code in <strong>that</strong> project directory.
      </p>

      <h2>Partial setup (no policy or worklogs)</h2>
      <p>
        Run <code>/install</code> in the target repo to merge <code>CLAUDE.md</code> and configure <code>.worklogs/</code>.
        See the <Link to="/docs/installation">installation guide</Link>.
      </p>

      <h2>Budget or gate stops every time</h2>
      <p>
        Run <code>/check budget</code> and inspect <code>.worklogs/&lt;id&gt;/state.json</code>. See{' '}
        <Link to="/docs/check-commands">check commands</Link>.
      </p>

      <h2>Wrong state after upgrading the pack</h2>
      <p>
        Major releases may change <code>state.json</code> or the state machine. Use{' '}
        <code>node scripts/migrate-work-state.js</code> (dry-run, then <code>--apply</code>) from a checkout of this
        repo. Read <code>CHANGELOG.md</code>. Edges must match <code>CLAUDE.md</code> and{' '}
        <code>{'${CLAUDE_PLUGIN_ROOT}/state-machine.json'}</code>.
      </p>

      <h2>Validate the plugin</h2>
      <p>
        From a clone of this repository, run <code>claude plugin validate</code> (or <code>/plugin validate</code> in
        Claude Code) if your CLI supports it. See <Link to="/docs/claude-code-plugin">Claude Code plugin</Link>.
      </p>

      <h2>License</h2>
      <p>
        Open-source terms are summarized in the <Link to="/docs/licensing">licensing overview</Link> (see repo{' '}
        <code>LICENSE</code> for the full text).
      </p>

      <h2>Privacy</h2>
      <p>
        How the plugin relates to data and third-party services:{' '}
        <Link to="/docs/privacy">Plugin privacy</Link>.
      </p>

      <h2>Issues &amp; contributions</h2>
      <p>
        <a href="https://github.com/surajSFDC/agentic-swe/issues" target="_blank" rel="noopener noreferrer">
          GitHub issues
        </a>
        .
      </p>
    </main>
  )
}
