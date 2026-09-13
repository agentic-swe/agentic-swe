# /fleet

Fleet muscle-memory operations for **consumer repos** (project root ≠ plugin pack) and **maintainer ingest**.

`goal_complete` stays **false** until ≥3 **independent** consumer teams archive submissions (`fleet_evidence_class=independent`). Maintainer dogfood uses `maintainer_dogfood` and is excluded from fleet-scale counts.

## Consumer team workflow

```bash
export AGENTIC_SWE_PROJECT_ROOT=/path/to/consumer-repo
npm run fleet-independent-bootstrap -- --consumer-root "$AGENTIC_SWE_PROJECT_ROOT" --merge-policy --write-workflow
# Complete ≥3 /work items; ensure validation→pr-creation records budget.tier_totals
npm run work-engine -- doctor --project-root "$AGENTIC_SWE_PROJECT_ROOT" --json
npm run fleet-evidence-bundle -- --project-root "$AGENTIC_SWE_PROJECT_ROOT" --out fleet-evidence.json
npm run fleet-submit -- --project-root "$AGENTIC_SWE_PROJECT_ROOT" --out fleet-submission.json
```

Uses default `fleet_evidence_class=independent`. For maintainer dogfood on sibling repos, use `fleet-consumer-bootstrap` instead.

## Maintainer ingest

```bash
npm run fleet-ingest-submission -- --submission /path/to/fleet-submission.json
npm run fleet-sync-memory
npm run fleet-learning-status -- --json
```

## Invite external teams (maintainer)

```bash
npm run fleet-export-invite -- --out fleet-team-invite.json
# or bundle invite + workflow template:
npm run fleet-share-kit -- --out-dir bench/results/fleet-share-kit
```

Share `fleet-team-invite.json` with consumer teams. They must use default `fleet_evidence_class=independent`.

## Consumer CI workflow (optional)

```bash
npm run fleet-onboard -- --project-root "$AGENTIC_SWE_PROJECT_ROOT" --write-workflow
```

Writes `.github/workflows/agentic-swe-fleet.yml` with `workflow_dispatch` + artifact upload.

## Maintainer dogfood (sibling repo)

```bash
npm run fleet-consumer-bootstrap -- \
  --consumer-root /path/to/sibling-repo \
  --merge-policy --seed-organic 3 --submit --ingest
```

Sets `AGENTIC_SWE_FLEET_EVIDENCE_CLASS=maintainer_dogfood` — archived for review, not fleet-scale credit.

## Subcommands (dispatch on `$ARGUMENTS`)

- `/fleet onboard` — run `fleet-onboard` for `AGENTIC_SWE_PROJECT_ROOT`
- `/fleet status` — `fleet-learning-status` + consumer checklist blockers
- `/fleet submit` — validate and write `fleet-submission.json` (consumer only)
- `/fleet ingest <path>` — maintainer archive + team memory index
