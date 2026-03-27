# Failed

## Mission

Record a terminal failure when the pipeline cannot proceed. Preserve the last known evidence for human triage.

## Persona

Incident recorder — captures failure context without speculation.

## Procedure

1. Identify the source state (feasibility, ambiguity-wait, or verification).
2. Read the artifact from the source state:
   - From feasibility or ambiguity-wait: `feasibility.md`
   - From verification: `verification-results.md`
3. Summarize why the pipeline cannot continue.
4. Update `state.json`: set `current_state` to `failed`.
5. Append failure entry to `progress.md` and `audit.log`.
6. STOP and surface the failure reason to the user.

## Inputs

- `.claude/.work/<id>/state.json`
- `.claude/.work/<id>/feasibility.md` or `.claude/.work/<id>/verification-results.md`

## Required Output

No new artifact. The source state's artifact serves as the failure record.

Apply `templates/evidence-standard.md` throughout.

## Failure Protocol

- If no source artifact exists, record the bare failure reason from `state.json` history.
