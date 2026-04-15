# Examples

Practical examples showing how to use the pipeline and subagents in real scenarios. For a timed **first install → `/work` → `.worklogs/`** walkthrough, start with **[Golden path](golden-path.md)** and the tiny **[golden-path-demo](https://github.com/surajSFDC/agentic-swe/tree/main/examples/golden-path-demo)** tree in the repo.

---

## Example 1: Simple Bug Fix (Lean Track)

A one-file bug fix that goes through the lean track:

```
> /work Fix the off-by-one error in pagination logic in src/api/list.py

Pipeline: initialized -> feasibility -> lean-track-check (lean track) -> lean-track-implementation -> validation -> pr-creation

[Pipeline scans the repo, identifies src/api/list.py]
[Determines this is a simple, single-file fix -- routes to lean track]
[Implements the fix, runs tests, creates PR]

PR created: https://github.com/your-org/your-repo/pull/42
Status: approval-wait -- review the PR and approve to merge.

> /work fix-off-by-one
[Detects approval, merges PR]
Status: completed
```

---

## Example 2: New Feature (Rigorous Track)

A multi-file feature that goes through design review:

```
> /work Add rate limiting middleware to the Express API with Redis backing

Pipeline: initialized -> feasibility -> lean-track-check (rigorous track) -> design -> design-review -> ...

[Pipeline scans repo, identifies Express setup, existing middleware patterns]
[Routes to rigorous track due to complexity -- multiple files, new dependency]
[Produces design.md with: architecture, file changes, API contract, test plan]
[Spawns design panel: architect + security + adversarial reviewers]
[Iterates on design based on panel feedback]
[Generates test stubs, implements feature, runs self-review]
[Code review passes, validation (tests + lint) passes]
[Creates PR with full context]

PR created: https://github.com/your-org/your-repo/pull/43
Status: approval-wait
```

---

## Example 3: Medium change (standard track)

A scoped feature with tests where the team wants design + implementation but **not** the full design panel or separate code-review phase (the Hypervisor sets `pipeline.track` to `standard` at `lean-track-check` when the verdict is `standard`):

```
> /work Add an internal CSV export endpoint with unit tests; use standard track / lighter review

Pipeline: initialized -> feasibility -> lean-track-check (standard) -> design -> verification -> test-strategy -> implementation -> self-review -> validation -> ...
```

See **`CLAUDE.md`** for which transitions are valid per track; do not use `design-review` or `code-review` on standard track unless you intentionally change `pipeline.track` and follow `/check transition`.

---

## Example 4: Using a Language Specialist Subagent

When you need deep language expertise outside the pipeline:

```
> /subagent invoke python-pro Refactor the data processing module to use async/await
  with proper error handling and type hints. Focus on src/processing/pipeline.py
  and src/processing/transforms.py

[Spawns python-pro subagent with model=sonnet]
[Agent analyzes the files, understands the data flow]
[Rewrites with async def, proper typing, structured error handling]
[Returns evidence-backed changes with before/after comparisons]
```

You can also invoke directly without `/subagent`:

```
> Use the rust-engineer subagent to fix the lifetime issues in src/parser/mod.rs.
  The compiler error is: "borrowed value does not live long enough"

[Spawns rust-engineer subagent]
[Agent reads the file, understands ownership/borrowing context]
[Provides fix with explanation of the lifetime rules at play]
```

---

## Example 5: Security Audit with Subagents

Run a focused security audit on your authentication system:

```
> /subagent invoke security-auditor Audit the authentication and authorization
  system in src/auth/. Check for OWASP Top 10 vulnerabilities, insecure
  token handling, and privilege escalation risks.

[Spawns security-auditor subagent with model=opus (deep reasoning)]
[Agent scans all auth-related files]
[Produces structured findings: critical/high/medium/low]
[Returns remediation recommendations with code examples]
```

For deeper coverage, run multiple auditors in parallel:

```
> Spawn security-auditor AND penetration-tester subagents in parallel to audit
  the payment processing module in src/payments/

[Both agents run simultaneously as background tasks]
[Security-auditor focuses on code-level vulnerabilities]
[Penetration-tester focuses on attack vectors and exploit paths]
[Results synthesized into a combined security report]
```

---

## Example 6: Multi-Agent Code Review

Get a thorough review from multiple specialist perspectives:

```
> Run code-reviewer, performance-engineer, and accessibility-tester subagents
  in parallel on the changes in the last 3 commits

[All 3 agents spawn simultaneously]
[code-reviewer: logic correctness, error handling, test coverage]
[performance-engineer: time complexity, memory usage, caching opportunities]
[accessibility-tester: ARIA attributes, keyboard navigation, screen reader support]
[Each returns structured findings with file:line evidence]
```

---

## Example 7: Infrastructure Work

Use infrastructure subagents for DevOps tasks:

```
> /subagent invoke kubernetes-specialist Review our Kubernetes manifests in
  k8s/ and suggest improvements for production readiness -- resource limits,
  health checks, security contexts, and horizontal pod autoscaling.

[Spawns kubernetes-specialist with model=sonnet]
[Agent reviews all YAML manifests]
[Returns specific improvements with corrected YAML snippets]
```

```
> /subagent invoke terraform-engineer Our Terraform state has drifted from
  the actual infrastructure. Analyze terraform/modules/ and help reconcile
  the configuration.

[Spawns terraform-engineer]
[Agent analyzes module structure, identifies drift patterns]
[Suggests targeted terraform import/state mv commands]
```

---

## Example 8: Planning a Complex Migration

Use plan-only mode to evaluate before committing:

```
> /plan-only Migrate the monolithic Express API to a microservices architecture
  using gRPC for inter-service communication

[Pipeline runs feasibility analysis]
[Identifies all route handlers, shared state, database dependencies]
[Produces a design with service boundaries, data ownership, migration phases]
[Design panel reviews for architectural soundness, security, and failure modes]
[Stops after design -- no code written]

You now have:
- feasibility.md: complexity assessment, risk analysis
- design.md: full architecture with migration plan
- design-panel-review.md: architect/security/adversarial feedback
```

---

## Example 9: Using Subagents for Research

```
> /subagent invoke competitive-analyst Analyze the top 5 authentication
  libraries for Node.js (Passport, Auth0, Clerk, NextAuth, Lucia).
  Compare features, security posture, maintenance activity, and
  community adoption. We need to pick one for our new project.

[Spawns competitive-analyst with model=sonnet]
[Agent researches each library across the criteria]
[Returns structured comparison matrix with recommendation]
```
