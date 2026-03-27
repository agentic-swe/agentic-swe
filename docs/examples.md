# Examples

Practical examples showing how to use the pipeline and subagents in real scenarios.

---

## Example 1: Simple Bug Fix (Fast Path)

A one-file bug fix that goes through the fast path:

```
> /work Fix the off-by-one error in pagination logic in src/api/list.py

Pipeline: initialized -> feasibility -> fast-path-check (fast path) -> fast-implementation -> validation -> pr-created

[Pipeline scans the repo, identifies src/api/list.py]
[Determines this is a simple, single-file fix -- routes to fast path]
[Implements the fix, runs tests, creates PR]

PR created: https://github.com/your-org/your-repo/pull/42
Status: approval-wait -- review the PR and approve to merge.

> /work fix-off-by-one
[Detects approval, merges PR]
Status: completed
```

---

## Example 2: New Feature (Full Path)

A multi-file feature that goes through design review:

```
> /work Add rate limiting middleware to the Express API with Redis backing

Pipeline: initialized -> feasibility -> fast-path-check (full path) -> design -> design-review -> ...

[Pipeline scans repo, identifies Express setup, existing middleware patterns]
[Routes to full path due to complexity -- multiple files, new dependency]
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

## Example 3: Using a Language Specialist Subagent

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

## Example 4: Security Audit with Subagents

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

## Example 5: Multi-Agent Code Review

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

## Example 6: Infrastructure Work

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

## Example 7: Planning a Complex Migration

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

## Example 8: Using Subagents for Research

```
> /subagent invoke competitive-analyst Analyze the top 5 authentication
  libraries for Node.js (Passport, Auth0, Clerk, NextAuth, Lucia).
  Compare features, security posture, maintenance activity, and
  community adoption. We need to pick one for our new project.

[Spawns competitive-analyst with model=sonnet]
[Agent researches each library across the criteria]
[Returns structured comparison matrix with recommendation]
```
