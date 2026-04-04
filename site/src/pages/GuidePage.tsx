import { Link } from 'react-router-dom'

export function GuidePage() {
  return (
    <main className="page-main reveal visible">
      <p className="section-label">// documentation</p>
      <h1>Guide</h1>
      <p>
        Install the pack, run <code>/work</code>, and understand how the Hypervisor, tracks, commands, and agents fit
        together.
      </p>

      <nav className="guide-toc" aria-label="On this page">
        <strong>On this page</strong>
        <ul>
          <li>
            <a href="#install">Install &amp; first run</a>
          </li>
          <li>
            <a href="#pipeline">Pipeline</a>
          </li>
          <li>
            <a href="#commands">Commands</a>
          </li>
          <li>
            <a href="#agents">Agents</a>
          </li>
          <li>
            <a href="#platforms">Platforms</a>
          </li>
          <li>
            <a href="#examples">Examples</a>
          </li>
        </ul>
      </nav>

      <h2 id="install">Install &amp; first run</h2>
      <p>
        agentic-swe is a <strong>markdown workflow pack</strong> for Claude Code: commands, phases, agents, templates, and
        hooks resolve from <code>{'${CLAUDE_PLUGIN_ROOT}/'}</code> when the plugin is enabled. Root <strong>Hypervisor</strong>{' '}
        policy merges into <code>CLAUDE.md</code>; per-work state lives under <code>.worklogs/&lt;id&gt;/</code>. There is{' '}
        <strong>no</strong> separate cloud runtime.
      </p>

      <h3>Prerequisites</h3>
      <ul>
        <li>
          <strong>Claude Code</strong> (primary host — see <a href="#platforms">Platforms</a>)
        </li>
        <li>
          <strong>Git</strong> — recommended for the target project
        </li>
        <li>
          <strong>GitHub CLI (<code>gh</code>)</strong> — optional; for PR flows
        </li>
      </ul>

      <h3>Enable the plugin</h3>
      <p>
        In Claude Code, add the marketplace and install the plugin (see{' '}
        <Link to="/docs/claude-code-plugin">Claude Code plugin</Link>):
      </p>
      <pre>
        {`/plugin marketplace add surajSFDC/agentic-swe
/plugin install agentic-swe@agentic-swe-catalog`}
      </pre>
      <p>
        In your <strong>target repository</strong>, run <code>/install</code> to merge the policy block into <code>CLAUDE.md</code>{' '}
        and configure <code>.worklogs/</code> (optional <code>.gitignore</code>).
      </p>

      <h3>Open Claude Code and start work</h3>
      <pre>
        {`cd /path/to/your/project
claude`}
      </pre>
      <p>Example task:</p>
      <pre>/work Add retry logic to the API client</pre>
      <p>
        The Hypervisor follows the root policy: feasibility, <code>lean-track-check</code>, then the track that matches
        risk (see <a href="#pipeline">Pipeline</a>).
      </p>

      <h3>Upgrades and repairs</h3>
      <p>
        Update the plugin from the marketplace; re-run <code>/install</code> if you need to refresh the merged policy
        block. Full detail: <Link to="/docs/installation">installation guide</Link>.
      </p>

      <h3>Local development</h3>
      <pre>claude --plugin-dir /path/to/agentic-swe-checkout</pre>
      <p>Run from your target project so the plugin root points at your clone of this repository.</p>

      <h3>Optional: repo knowledge</h3>
      <p>
        Teams may add an <code>AGENTS</code> companion file, knowledge under <code>docs/agentic-swe/</code>, etc., for
        extra context during feasibility — see the longer <Link to="/docs/installation">installation guide</Link>.
      </p>

      <h2 id="pipeline">Pipeline &amp; Hypervisor</h2>
      <p>
        agentic-swe is a <strong>finite state machine</strong> with explicit artifacts, iteration budgets, and human
        gates. The <strong>Hypervisor</strong> is the primary chat session that reads and writes <code>state.json</code>,
        invokes <code>/check</code>, delegates to core agents and subagents, and never skips persisted transitions.
      </p>

      <h3>Source of truth per work item</h3>
      <p>Each run lives under <code>.worklogs/&lt;id&gt;/</code>:</p>
      <ul>
        <li>
          <code>state.json</code> — <code>current_state</code>, <code>pipeline.track</code>, budgets, counters,{' '}
          <code>history</code>
        </li>
        <li>
          <code>progress</code> log — human-readable (plus a context summary every third transition)
        </li>
        <li>
          <code>audit.log</code> — append-only delegation and gate trail
        </li>
        <li>Phase artifacts — e.g. feasibility, design, implementation write-ups, …</li>
      </ul>

      <h3>Three tracks</h3>
      <p>
        After <code>feasibility</code>, <code>lean-track-check</code> sets <code>pipeline.track</code> in{' '}
        <code>state.json</code>:
      </p>
      <table>
        <thead>
          <tr>
            <th>Track</th>
            <th>When</th>
            <th>Shape (abbreviated)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>lean</strong>
            </td>
            <td>
              Verdict <code>simple</code>
            </td>
            <td>
              … → <code>lean-track-implementation</code> → <code>validation</code> → <code>pr-creation</code> → …
            </td>
          </tr>
          <tr>
            <td>
              <strong>standard</strong>
            </td>
            <td>
              Verdict <code>standard</code>
            </td>
            <td>
              … → <code>design</code> → <code>verification</code> → <code>test-strategy</code> →{' '}
              <code>implementation</code> → <code>self-review</code> → <code>validation</code> → … — skips design panel,{' '}
              <code>design-review</code>, <code>code-review</code>, <code>permissions-check</code>
            </td>
          </tr>
          <tr>
            <td>
              <strong>rigorous</strong>
            </td>
            <td>
              Verdict <code>complex</code>
            </td>
            <td>
              Full path including design panel, <code>design-review</code>, <code>code-review</code>,{' '}
              <code>permissions-check</code>
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        Allowed edges depend on the active track. If <code>pipeline.track</code> is missing on legacy work, treat as{' '}
        <strong>rigorous</strong> when interpreting transitions.
      </p>

      <h3>Transition graph</h3>
      <p>
        The canonical directed edges are in the fenced block in the root Hypervisor policy and mirrored in{' '}
        <code>{'${CLAUDE_PLUGIN_ROOT}/state-machine.json'}</code> (enforced by tests in the package repo). Before every state change, the
        Hypervisor runs <code>/check transition</code> and <code>/check artifacts</code>.
      </p>

      <h3>Human gates and escalations</h3>
      <ul>
        <li>
          <strong>ambiguity-wait</strong> — task unclear; needs human answers before continuing
        </li>
        <li>
          <strong>approval-wait</strong> — PR exists; wait for real review/approval
        </li>
        <li>
          <strong>escalate-code</strong> / <strong>escalate-validation</strong> — loops exhausted or environment blocked
        </li>
        <li>
          <strong>pipeline-failed</strong> — hard stop from feasibility or verification failure
        </li>
      </ul>

      <h3>Budgets and loops</h3>
      <p>
        Design review, implementation vs code review, lean implementation review, self-review, approval rejection, and
        merge-conflict cycles all have <strong>explicit caps</strong> documented in the Hypervisor policy. Counters live
        in <code>state.json</code>. Non-converging loops (same root cause in consecutive rejections) should{' '}
        <strong>escalate</strong> instead of burning budget.
      </p>

      <h2 id="commands">Commands</h2>
      <p>
        Slash commands live under <code>{'${CLAUDE_PLUGIN_ROOT}/commands/'}</code> after install. They are the{' '}
        <strong>structured entry points</strong> the Hypervisor and phases invoke for work lifecycle, gates, and
        utilities.
      </p>

      <h3>Core workflow</h3>
      <table>
        <thead>
          <tr>
            <th>Command</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>/work</code>
            </td>
            <td>
              Start a new work item or resume by id; creates <code>.worklogs/&lt;id&gt;/</code> and seeds{' '}
              <code>state.json</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>/plan-only</code>
            </td>
            <td>Feasibility and design only — no implementation branch</td>
          </tr>
          <tr>
            <td>
              <code>/evaluate-work</code>
            </td>
            <td>Inspect a work item’s state and artifacts</td>
          </tr>
          <tr>
            <td>
              <code>/install</code>
            </td>
            <td>
              Guided <code>CLAUDE.md</code> merge, <code>.worklogs/</code>, optional <code>.gitignore</code>
            </td>
          </tr>
        </tbody>
      </table>

      <h3>
        Enforcement (<code>/check</code>)
      </h3>
      <p>
        Mandatory before expensive moves: <code>/check budget</code>, <code>/check transition</code>,{' '}
        <code>/check artifacts</code>. Behavior and subcommands are documented in the{' '}
        <Link to="/docs/check-commands">check commands reference</Link>.
      </p>

      <h3>Discovery and specialists</h3>
      <ul>
        <li>
          <code>/repo-scan</code> — structured snapshot of languages, tests, CI (feasibility input)
        </li>
        <li>
          <code>/subagent</code> — browse and invoke specialist prompts from <code>{'${CLAUDE_PLUGIN_ROOT}/agents/subagents/'}</code>
        </li>
      </ul>

      <h3>Utility skills</h3>
      <p>Phases call these when evidence is needed:</p>
      <ul>
        <li>
          <code>/test-runner [scope]</code>
        </li>
        <li>
          <code>/lint [scope]</code>
        </li>
        <li>
          <code>/diff-review [range]</code>
        </li>
        <li>
          <code>/ci-status [PR|branch]</code>
        </li>
        <li>
          <code>/conflict-resolver [command]</code>
        </li>
        <li>
          <code>/security-scan [scope]</code>
        </li>
      </ul>

      <h2 id="agents">Agents</h2>
      <p>
        Agents are <strong>markdown prompts</strong> under <code>{'${CLAUDE_PLUGIN_ROOT}/agents/'}</code>. The Hypervisor delegates bounded
        work; it remains accountable for state, transitions, and synthesis.
      </p>

      <h3>Core agents</h3>
      <ul>
        <li>
          <strong>developer-agent</strong> — implementation in a bounded scope (optional worktree isolation)
        </li>
        <li>
          <strong>git-operations-agent</strong> — branches, sync, conflict resolution
        </li>
        <li>
          <strong>pr-manager-agent</strong> — PR creation and management
        </li>
      </ul>

      <h3>Design panel</h3>
      <p>
        On the <strong>rigorous</strong> track, when complexity warrants it, three panel agents run in parallel:
        architect, security, adversarial. Results merge into a <code>design-panel-review</code> artifact; the Hypervisor
        resolves conflicts.
      </p>

      <h3>Subagents (135+)</h3>
      <p>
        Specialists live under <code>{'${CLAUDE_PLUGIN_ROOT}/agents/subagents/<category>/'}</code> (core-development,
        language-specialists, infrastructure, quality-security, data-ai, …). Use <code>/subagent</code> to discover them,
        or rely on <strong>auto-selection</strong> during phases (see{' '}
        <a
          href="https://github.com/surajSFDC/agentic-swe/blob/main/phases/subagent-selection.md"
          target="_blank"
          rel="noopener noreferrer"
        >
          subagent selection
        </a>{' '}
        in the pack).
      </p>
      <p>
        Feasibility writes a <strong>Subagent Signals</strong> section into the feasibility artifact; downstream phases
        map signals to agents. When <code>budget_remaining</code> is low, auto-selection may be skipped.
      </p>

      <h3>Agent-to-agent</h3>
      <p>
        A core agent may spawn at most <strong>one</strong> subagent per phase when domain depth is needed. Spawns and
        returns are logged in <code>audit.log</code> per the Hypervisor policy.
      </p>

      <h2 id="platforms">Platforms</h2>
      <p>
        Host comparison table and install pointers: <Link to="/docs/multi-platform-support">Multi-platform support</Link>{' '}
        (dedicated doc).
      </p>
      <p>
        agentic-swe is <strong>host-agnostic markdown</strong>: with the Claude Code plugin, the pack lives at the plugin
        root (<code>commands/</code>, <code>phases/</code>, …) and resolves via <code>{'${CLAUDE_PLUGIN_ROOT}/'}</code>. The{' '}
        <strong>Hypervisor</strong> is whichever session follows root <code>CLAUDE.md</code> policy.
      </p>

      <h3>Claude Code</h3>
      <p>
        First-class: native slash commands, hooks, and Agent tool align with the plugin layout this repo ships. Enable the
        plugin, run <code>/install</code> in your project, then <code>/work</code>.
      </p>

      <h3>Cursor</h3>
      <p>
        Use project rules to point agents at the root Hypervisor policy and <code>{'${CLAUDE_PLUGIN_ROOT}/phases/'}</code>. Slash commands
        are not automatic — invoke phase files or wrap them in custom rules/skills as needed.
      </p>

      <h3>Codex / other assistants</h3>
      <p>
        An <code>AGENTS</code> file in the repo root summarizes orchestration for tools that read it; full detail remains
        in the Hypervisor policy.
      </p>

      <h3>CI and headless</h3>
      <p>
        This repository includes tests and smoke checks for layout and state-machine consistency; running the full pipeline
        still expects an interactive host for human gates.
      </p>

      <h2 id="examples">Examples</h2>
      <p>
        These are <strong>illustrative</strong> transcripts. Full narrative versions are in the{' '}
        <Link to="/docs/examples">examples collection</Link>.
      </p>

      <h3>Simple bug fix (lean track)</h3>
      <pre>/work Fix the off-by-one error in pagination logic in src/api/list.py</pre>
      <p>
        Typical path: <code>initialized</code> → <code>feasibility</code> → <code>lean-track-check</code> (track{' '}
        <strong>lean</strong>) → <code>lean-track-implementation</code> → <code>validation</code> →{' '}
        <code>pr-creation</code> → <code>approval-wait</code>. After the real PR exists, resume with{' '}
        <code>/work &lt;id&gt;</code> when review is done.
      </p>

      <h3>New feature (rigorous track)</h3>
      <pre>/work Add rate limiting middleware to the Express API with Redis backing</pre>
      <p>
        Multi-file scope and new dependencies often yield track <strong>rigorous</strong>: design, optional design panel,{' '}
        <code>design-review</code>, <code>verification</code>, <code>test-strategy</code>, <code>implementation</code>,{' '}
        <code>self-review</code>, <code>code-review</code>, <code>permissions-check</code>, <code>validation</code>, PR.
      </p>

      <h3>Medium change (standard track)</h3>
      <pre>/work Add an internal CSV export endpoint with unit tests</pre>
      <p>
        When feasibility verdict is <strong>standard</strong>, you get design + verification + tests + implementation +
        self-review + validation, but <strong>not</strong> the full design panel / separate <code>code-review</code>{' '}
        phase as in rigorous. Always confirm edges with <code>/check transition</code> for the active{' '}
        <code>pipeline.track</code> in <code>state.json</code>.
      </p>

      <h3>Language specialist outside the pipeline</h3>
      <pre>/subagent invoke python-pro Refactor src/processing/pipeline.py to async/await with typed errors</pre>
      <p>
        Manual subagent use is independent of <code>/work</code>; log delegation in <code>audit.log</code> if it affects
        governed work.
      </p>

      <h3>Plan without implementing</h3>
      <pre>/plan-only Evaluate adding OAuth2 to the public API</pre>
      <p>Stops after planning phases — no implementation branch unless you start a new <code>/work</code>.</p>

      <h3>Resume a work item</h3>
      <pre>/work abc123</pre>
      <p>
        Reads <code>.worklogs/abc123/state.json</code> and continues from <code>current_state</code> per{' '}
        <a href="#pipeline">Pipeline</a>.
      </p>

      <div className="doc-see-also">
        <strong>Canonical policy</strong> —{' '}
        <a href="https://github.com/surajSFDC/agentic-swe/blob/main/CLAUDE.md" target="_blank" rel="noopener noreferrer">
          Hypervisor policy on GitHub
        </a>
        <br />
        <strong>More</strong> — <Link to="/docs/subagent-catalog">Subagent catalog</Link> ·{' '}
        <Link to="/docs/usage">Usage</Link> · <Link to="/docs/claude-code-plugin">Claude Code plugin</Link> ·{' '}
        <Link to="/docs/multi-platform-support">Multi-platform support</Link>
      </div>
    </main>
  )
}
