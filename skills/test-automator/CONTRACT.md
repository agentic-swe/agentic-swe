# Contract — test-automator

Domain: **Testing**

First-party skill contract for AE-029a / ADR-010. Tests are deterministic and offline (PD-9).

## Inputs
- `target` (string, required): Code or suite to automate
- `framework` (string)

## Outputs
- `test_plan` (string)
- `test_artifacts` (files)

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
