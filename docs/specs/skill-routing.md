# Skill routing (implementation spec)

AE-026a (explainable routing) + AE-026b (accuracy benchmark + fallback). User-facing discovery stays on `scripts/skill-route.cjs` / session skill-route hints.

## Layout

| Path | Role |
|------|------|
| `scripts/lib/skills/skill-router.cjs` | Lexical rank + score breakdown + reject reasons + fallback |
| `scripts/lib/skills/routing-fallback.cjs` | Fallback matrix resolver (product contract) |
| `scripts/lib/skills/routing-benchmark.cjs` | Offline hit@k / precision / recall against frozen fixture |
| `scripts/skill-route.cjs` | Interactive CLI |
| `scripts/skill-route-bench.cjs` | Benchmark CLI (exit 1 below threshold) |
| `config/skill-routing-benchmark.json` | Frozen golden queries + documented thresholds |
| `test/skill-route-explain.test.js` | AE-026a explainability / reject / PD-9 |
| `test/skill-route-benchmark.test.js` | AE-026b threshold gate |
| `test/skill-route-fallback.test.js` | Fallback matrix cases |

## Offline / PD-9

Routing and the benchmark are deterministic and local. No paid LLM providers. Callers may inject a `transport.fetch` spy; the router never invokes it unless `forceNetwork` is set (which throws).

## Fallback matrix

| Condition | `fallback.code` | Action |
|-----------|-----------------|--------|
| Catalog has zero skills | `EMPTY_CATALOG` | Return no candidates; never invent skills |
| Autonomous path; every skill gated | `ALL_GATED` | Empty selectable `results`; keep `rejected[]` with `EVAL_GATE` |
| Top score below low-confidence bar (default **0.5**) | `LOW_CONFIDENCE` | Do not auto-invoke; prefer manual selection |
| No relevant / all filtered | `NO_SKILL` | Empty `results`; surface reject reasons |
| Two or more candidates share the top score | `TIE_BREAK` | Stable alphabetical skill-name order (informational) |

Fail-closed guidance: do **not** auto-invoke when code is `EMPTY_CATALOG`, `ALL_GATED`, `NO_SKILL`, or `LOW_CONFIDENCE`. `TIE_BREAK` only documents ordering; the first row after alphabetical sort remains the selectable top hit.

## Benchmark thresholds

Documented in `config/skill-routing-benchmark.json` → `thresholds` (founder may adjust in a follow-up PR):

- `hit_at_1` ≥ **0.7**
- `hit_at_3` ≥ **0.9**
- `precision_at_k` ≥ **0.15**
- `recall_at_k` ≥ **0.7**
- `k` = **5**

`npm run bench:skill-route` prints precision/recall and hit@k and exits non-zero if any threshold fails. CI covers the same gate via `test/skill-route-benchmark.test.js`. Do not commit generated `bench/results/*.json` for this harness; the fixture lives under `config/`.
