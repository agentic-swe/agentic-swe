# Jev advisory classifier

Jev is TypeSafe AI's System One model. It answers typed questions with probabilities. agentic-swe calls `POST https://api.typesafe.ai/v1/systemone` from `scripts/lib/jev/client.cjs`. The pinned default model is `jev-1.13.0`.

Jev never selects `pipeline.track`, never writes phase artifacts, and never replaces a host model on its own. Each seam keeps the existing local decision as the fallback.

## Seams

| Seam | Call | Fallback |
|---|---|---|
| Track | `scripts/jev-track-hint.cjs` during `lean-track-check` | Phase heuristic and the Adaptive Track Router (`pipeline.track_recommendation`) |
| Model tier | `scripts/session-model-tier-hint.cjs` | Static phase tier in `config/model-routing.default.json` |
| Subagents | `scripts/catalog-route.cjs` after the top slice | Original lexical or embedding order in `results` |
| Skills | `scripts/session-skill-route-hint.cjs` after lexical ranking | Original lexical and memory order |

Track results are stored on `state.json` as `pipeline.jev_track`. A `lean` choice with any risk noul above `risk_noul_caution` (default 0.8) sets `caution`. The hypervisor still chooses the track and records disagreements in `lean-track-check.md`.

The model-tier hint follows Jev only when choice confidence is at least `choice_confidence_min` (default 0.7). Otherwise the headline tier stays the phase tier.

Subagent routing asks one choice over at most `shortlist` candidates (default 8). `results` stay in retrieval order. The `jev` field carries the advisory order.

Skill routing asks one noul per shortlisted skill. The session hint prints a Jev order only when some noul is at least `noul_floor` (default 0.4). The lexical list stays in place.

## Fallback reasons

`disabled`, `missing_key`, `timeout`, `http_error`, `invalid_response`, and `low_confidence`.

Opt out with `AGENTIC_SWE_JEV=0`. Set `TYPESAFE_API_KEY` to enable calls. `TYPESAFE_MODEL` overrides the pinned model. Optional repo overrides live in `.agentic-swe/jev.json` and merge over `config/jev.default.json`.

Session hints stay quiet when Jev is disabled or the key is missing, so those sessions match the pre-Jev hint text. An explicit track hint still records the skip on `pipeline.jev_track` and in `audit.log`.

Audit lines use `actor=jev` and include the seam, model, reason, and token counts. They do not include the API key or response bodies.

## What stays on the host model

Design, implementation, and review stay on the host model. Jev only classifies short state: the feasibility writeup (capped at 8000 characters) or the task and shortlist (capped at 4000).
