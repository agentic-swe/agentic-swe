# AE-R06 — VoltAgent subagent clean-room rewrite plan

**Decision (2026-11-03):** rewrite from scratch (option c). Keep filenames, `name`, and category folders stable.

## PR series

| PR | Scope |
|---|---|
| **1 (this)** | `NOTICE`, provenance frontmatter schema + `catalog-lint`, report-only `provenance-check`, pinned `config/upstream-fingerprints.json` (hashes only), generate-skills provenance passthrough, this plan |
| **2** | `core-development` + `research-analysis` (~17) |
| **3** | `business-product` + `meta-orchestration` (~21; rewrite `agent-installer` away from VoltAgent URLs) |
| **4** | `data-ai` + `developer-experience` (~26) |
| **5** | `infrastructure` (~16) |
| **6** | `quality-security` (~14) |
| **7** | `specialized-domains` non-Salesforce (~12) |
| **8** | `language-specialists` batch A (~15) |
| **9** | `language-specialists` batch B (~14) |
| **10 (final)** | Enforce `provenance-check --enforce`, remove `NOTICE`, verify catalog counts / zero over-threshold |

Salesforce agents (`salesforce-*`) stay first-party; no rewrite required.

## Clean-room rules

Writers receive only: agent `name`, one paraphrased role line from `description`, frontmatter schema, tool/model conventions, and first-party style (core `agents/*.md`, Salesforce subagents). Do **not** read existing copied bodies or upstream bodies when writing.

## Similarity gate

- Fingerprints: 5-token shingle SHA-256 truncations in `config/upstream-fingerprints.json` (no upstream prose).
- Threshold: Jaccard ≥ 0.5 fails under `--enforce`.
- PR1 runs report-only so remaining copies stay attributed via `NOTICE` + `provenance.origin: upstream`.
