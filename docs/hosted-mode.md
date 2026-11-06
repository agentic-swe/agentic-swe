# Hosted mode (M2 / PD-24)

**Decision:** M2 hosted mode runs as a **separate local OS user/process** that the agent process cannot write to. The journal (and optionally the pinned policy digest file) live outside the agent's write reach.

In-host mode (Claude Code, Cursor, Codex, …) remains **cooperative**: the agent can rewrite local files, so "enforced outside the LLM" is labeled cooperative there (ADR-001). Hosted mode is **not required** for in-host use.

## Setup sketch (document only; not auto-enforced)

1. Create a dedicated OS user, e.g. `agentic-swe-runtime`.
2. Own worklogs under a path only that user can write, e.g. `/var/lib/agentic-swe/worklogs/`.
3. Run the hosted runtime (`AE-020c`) as that user.
4. Agents interact via IPC/CLI that appends through the runtime; they never get write access to `journal.jsonl`.
5. Optionally pin the policy digest with `AGENTIC_SWE_POLICY_DIGEST=<sha256>` from a file the agent cannot modify.

The deterministic fixture/local-provider loop can be started with:

```sh
agentic-swe runtime run --work-dir .worklogs/<id> --track lean --provider fixture
```

The loop stops at `approval-wait`; only the human approval command can leave that state.

## Digest pinning

When `AGENTIC_SWE_POLICY_DIGEST` is set, the PDP denies with `policy.digest_mismatch` / `POLICY_CRITICAL` if the merged policy hash differs. Pinning is meaningful only when the env/file is outside the agent's write scope (hosted). In in-host mode the pin is advisory.

## Related

- PD-16: durable store is JSONL (+ leases + dedupe); no SQLite/Postgres in M2.
- PD-24: this hosted boundary.
- AE-022: PDP + `policy.decided` + `agentic-swe policy replay`.
