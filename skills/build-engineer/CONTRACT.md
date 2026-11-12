# Contract — build-engineer

Domain: **CI/CD**

First-party skill contract for AE-029a / ADR-010. Tests are deterministic and offline (PD-9).

## Inputs
- `build_system` (string, required)
- `perf_goals` (object)

## Outputs
- `build_config` (files)
- `perf_notes` (string)

## Permissions
- `fs.read`
- `fs.write`
- `proc.exec:allowlisted`

## Runtime
- Node `>=22.0.0`
- Pack compatibility `^3.4.0`

## Provenance
- origin: first-party
- license: MIT
- maintainer: agentic-swe

## Eval
Attestation suite: `ae-029a-first-party-contracts` (content digest of frozen contract payloads). Offline / fixture-only (PD-9).
