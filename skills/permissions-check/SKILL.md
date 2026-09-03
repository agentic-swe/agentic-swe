---
name: permissions-check
description: "Pipeline phase skill for state `permissions-check`. Use when current_state is permissions-check."
metadata:
  tier: "L2"
  eval_status: "evaluated"
  eval_ref: "bench/corpus/oracle-references"
  version: "1.0.0"
  provenance: "generate-skills"
  kind: "phase"
  source: "phases/permissions-check.md"
---

# Permissions

## Mission

Identify non-code changes required for the feature to actually function in the repository's runtime or packaging model.

## Persona

Production readiness engineer — looks beyond source files, assumes configuration and exposure surfaces are easy to miss.

## Procedure

1. Read the design and implementation artifacts.
2. If the feature touches **external services**, **MCP**, **deployment**, or **secrets**, consult `${CLAUDE_PLUGIN_ROOT}/references/tooling-expectations.md` for safety expectations before recommending operational changes.
3. Inspect all operational surfaces that may gate functionality:
   - configuration files, routing/navigation tables
   - exports and package manifests
   - feature flags, access-control rules
   - deployment descriptors, operational documentation
4. Invoke `/security-scan` scoped to affected files to check for secrets, dangerous patterns, and configuration issues.
5. Decide whether the feature is actually reachable and enabled after the code change.
6. Distinguish required changes, warnings, and blockers.

## Inputs

- `.worklogs/<id>/design.md`
- `.worklogs/<id>/implementation.md`
- Repository configuration and manifest files

## Required Output

Write `.worklogs/<id>/permissions-changes.md` following `${CLAUDE_PLUGIN_ROOT}/templates/artifact-format.md`, with:

- affected operational surfaces
- required changes, warnings, blockers
- recommended next state

Apply `${CLAUDE_PLUGIN_ROOT}/templates/evidence-standard.md` throughout.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The code works in tests — permissions must be fine." | Tests typically run with elevated or mocked permissions. Production environments enforce access control, feature flags, and configuration gates that tests bypass. |
| "We didn't change any config files, so there's nothing to check." | New code paths may require new exports, route registrations, feature flag entries, or deployment descriptor updates even when no config file was directly edited. |
| "Security scan is overkill for this change." | Security scans catch secrets in code, dangerous dependency patterns, and configuration exposures that manual review consistently misses — especially in seemingly low-risk changes. |
| "The existing deployment pipeline handles this automatically." | Deployment pipelines handle what they are configured for. New operational surfaces (endpoints, environment variables, access patterns) require explicit registration. |

## Red Flags

- Permissions artifact lists "no changes required" but the implementation added new API endpoints, environment variables, or external service calls.
- `/security-scan` was not invoked despite the implementation touching authentication, authorization, or secrets-adjacent code.
- The artifact does not mention feature flags or access-control rules when the change introduces user-facing behavior.
- Deployment descriptors are unchanged despite new runtime dependencies or configuration requirements.
- The artifact contains no evidence citations — only assertions that operational surfaces are unaffected.

## Failure Protocol

- if the feature is correct in code but unavailable operationally, treat that as a real blocker
- do not assume defaults or permissions are acceptable without evidence
