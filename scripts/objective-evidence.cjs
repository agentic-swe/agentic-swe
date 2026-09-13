#!/usr/bin/env node
/**
 * Requirement-by-requirement evidence matrix for the muscle-memory orchestrator objective.
 * Does not mark the product goal complete; reports claim_status honestly.
 *
 * Usage:
 *   node scripts/objective-evidence.cjs [--out bench/results/objective-evidence-<date>.json]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const { checkSkillEvalGate } = require('./lib/skills/eval-gate.cjs');
const { listSkills } = require('./lib/skills/skill-router.cjs');
const { aggregateProductionTierTotals } = require('./lib/bench/production-tier-totals.cjs');

function exists(root, rel) {
  return fs.existsSync(path.join(root, rel));
}

function latestJson(dir, prefix) {
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .sort();
  if (!files.length) return null;
  return JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), 'utf8'));
}

function main() {
  const root = getDefaultPluginRoot();
  const date = new Date().toISOString().slice(0, 10);
  const outIdx = process.argv.indexOf('--out');
  const outPath =
    outIdx >= 0
      ? process.argv[outIdx + 1]
      : path.join(root, 'bench', 'results', `objective-evidence-${date}.json`);

  const skills = listSkills(root);
  const unevaluated = skills.filter((s) => s.eval_status !== 'evaluated');
  const unknownBlocked = checkSkillEvalGate({
    pluginRoot: root,
    skillName: '__no_such_skill__',
    autonomous: true,
  });

  const scorecard = latestJson(path.join(root, 'bench', 'results'), 'token-reduction-');
  const portfolio = latestJson(path.join(root, 'bench', 'results'), 'portfolio-');
  const livePath = latestJson(path.join(root, 'bench', 'results'), 'live-path-');
  const organicPf = latestJson(path.join(root, 'bench', 'results'), 'organic-portfolio-');
  const transcriptDescent = latestJson(path.join(root, 'bench', 'results'), 'transcript-descent-');
  const gitDescent = latestJson(path.join(root, 'bench', 'results'), 'git-descent-');
  const gitPackDescent = latestJson(path.join(root, 'bench', 'results'), 'git-pack-descent-');
  const organicDescent = latestJson(path.join(root, 'bench', 'results'), 'organic-descent-');
  const sessionMineDescent = latestJson(path.join(root, 'bench', 'results'), 'session-mine-descent-');
  const consumerRepoDescent = latestJson(path.join(root, 'bench', 'results'), 'consumer-repo-descent-');
  const consumerFleetReadiness = latestJson(path.join(root, 'bench', 'results'), 'consumer-fleet-readiness-');
  const { summarizeFleetSubmissions, listArchivedSubmissions } = require('./ingest-fleet-submission.cjs');
  const { summarizeFleetArchiveEntries } = require('./lib/fleet/archive-summaries.cjs');
  const { listMaintainerDogfoodConsumerRoots } = require('./lib/fleet/dogfood-consumers.cjs');
  const { evaluateFleetScaleGate } = require('./lib/fleet/fleet-scale-gate.cjs');
  const fleetScaleGate = evaluateFleetScaleGate(root);
  const fleetSummaryAll = summarizeFleetSubmissions(root);
  const fleetSummary = summarizeFleetSubmissions(root, { forFleetScale: true });
  const fleetArchiveDetail = summarizeFleetArchiveEntries(listArchivedSubmissions(root));
  const implEntry = latestJson(path.join(root, 'bench', 'results'), 'implementation-entry-');
  const production = aggregateProductionTierTotals(root);
  const claim =
    portfolio?.combined?.claim_status ||
    scorecard?.warm_portfolio_projection?.claim_status ||
    'unknown';

  const requirements = [
    {
      id: 'installable-plugin',
      requirement: 'Single installable plugin/tool',
      evidence: ['.claude-plugin/plugin.json', 'package.json'],
      status: exists(root, '.claude-plugin/plugin.json') && exists(root, 'package.json') ? 'met' : 'missing',
    },
    {
      id: 'versioned-evaluated-skills',
      requirement: 'Every SWE operation is a versioned, evaluated skill',
      evidence: [`${skills.length} skills, ${unevaluated.length} unevaluated`],
      status: skills.length > 0 && unevaluated.length === 0 ? 'met' : unevaluated.length ? 'partial' : 'missing',
    },
    {
      id: 'eval-harness',
      requirement: 'Eval harness gating every skill (fail-closed, flags unevaluated/unknown)',
      evidence: ['scripts/lib/skills/eval-gate.cjs', 'scripts/skill-eval.cjs'],
      status:
        exists(root, 'scripts/lib/skills/eval-gate.cjs') && unknownBlocked.allowed === false
          ? 'met'
          : 'incomplete',
    },
    {
      id: 'session-memory-graph',
      requirement: 'Conversations chunked into sessions and distilled into memory graph (personal + team/repo)',
      evidence: [
        'scripts/lib/memory/ingest-scopes.cjs',
        'scripts/lib/memory/discover-transcripts.cjs',
        'scripts/ingest-memory-scopes.cjs',
        'scripts/session-capture.cjs',
        'scripts/session-chat-warm.cjs',
        'ingestOrganicWorklogs',
        'ingestProjectSkills',
        'mine-transcript-procedures (tool_use Read/Shell)',
      ],
      status:
        exists(root, 'scripts/lib/memory/ingest-scopes.cjs') &&
        exists(root, 'scripts/lib/memory/discover-transcripts.cjs') &&
        exists(root, 'scripts/session-capture.cjs') &&
        exists(root, 'scripts/session-chat-warm.cjs')
          ? 'met'
          : 'missing',
    },
    {
      id: 'runtime-skill-discovery',
      requirement: 'Discovers/selects skills at runtime and flags unevaluated',
      evidence: [
        'scripts/lib/skills/skill-router.cjs',
        'scripts/session-skill-route-hint.cjs',
        'scripts/lib/skills/skill-eval-suggestions.cjs',
        'routeSkillsWithMemory (graph + procedure boost)',
      ],
      status: exists(root, 'scripts/lib/skills/skill-router.cjs') ? 'met' : 'missing',
    },
    {
      id: 'self-evolving-skill-eval',
      requirement: 'Self-evolution: mined procedure rituals suggest and optionally promote skill-eval candidates',
      evidence: [
        'scripts/lib/skills/skill-eval-suggestions.cjs',
        'scripts/lib/skills/project-skills.cjs (.agentic-swe/skills scaffold)',
        'scripts/skill-eval.cjs suggest|promote-rituals|scaffold-rituals',
        'scripts/session-skill-route-hint.cjs (promote section)',
        'AGENTIC_SWE_PROMOTE_RITUALS on session-capture evolve-cycle',
        'scripts/fleet-evidence-bundle.cjs',
        'scripts/fleet-onboard.cjs',
        'scripts/fleet-submit.cjs',
      ],
      status:
        exists(root, 'scripts/lib/skills/skill-eval-suggestions.cjs') &&
        exists(root, 'scripts/session-skill-route-hint.cjs')
          ? 'met'
          : 'missing',
    },
    {
      id: 'model-agnostic',
      requirement: 'Survives model churn (capability tiers, host maps)',
      evidence: [
        'config/model-map.claude-code.json',
        'config/model-map.cursor.json',
        'config/model-map.codex.json',
        'config/model-map.gemini.json',
        'config/model-map.opencode.json',
        'scripts/model-conformance.cjs',
      ],
      status:
        exists(root, 'config/model-map.cursor.json') &&
        exists(root, 'config/model-map.gemini.json') &&
        exists(root, 'scripts/model-conformance.cjs')
          ? 'met'
          : 'missing',
    },
    {
      id: 'architecture-research',
      requirement: 'Deep research + validated architecture plan',
      evidence: [
        'docs/research/muscle-memory-sota.md',
        'docs/specs/muscle-memory-orchestrator.md',
        'docs/specs/memory-graph.md',
      ],
      status:
        exists(root, 'docs/research/muscle-memory-sota.md') &&
        exists(root, 'docs/specs/muscle-memory-orchestrator.md')
          ? 'met'
          : 'missing',
    },
    {
      id: 'token-reduction-benchmarks',
      requirement: 'Benchmarks proving per-task tokens toward 1–2% of cold',
      evidence: [
        claim,
        portfolio?.combined?.portfolio_multiplier != null
          ? `portfolio_multiplier=${portfolio.combined.portfolio_multiplier}`
          : 'no portfolio artifact',
      ],
      status:
        claim === 'proven_at_scale'
          ? 'met'
          : claim === 'proven_e2e_bench'
            ? 'partial'
            : 'incomplete',
    },
    {
      id: 'live-path-reproducible',
      requirement: 'Isolated work-engine live-path bench (tmp .worklogs; not pack-root proven_at_scale)',
      evidence: [
        livePath
          ? `live-path ok=${livePath.ok} items=${livePath.live_work_items} verified=${livePath.live_production_verified}`
          : 'no live-path artifact',
      ],
      status: livePath?.ok === true && (livePath.live_work_items || 0) >= 1 ? 'met' : 'incomplete',
    },
    {
      id: 'live-production-learning',
      requirement: 'Pack-root live .worklogs with tier_totals (includes CI/maintainer dogfood applyTransition)',
      evidence: [
        `pack_live_work_items=${production.sources?.live ?? 0}`,
        `dogfood=${production.sources?.dogfood ?? 0}`,
      ],
      status: (production.sources?.live || 0) >= 1 ? 'met' : 'incomplete',
    },
    {
      id: 'organic-team-learning',
      requirement: 'Learns from non-dogfood /work (organic pipeline worklogs in pack-root .worklogs, not bench fixtures)',
      evidence: [
        `organic_live=${production.sources?.organic_live ?? 0}`,
        `organic_fixtures=${production.sources?.organic_fixtures ?? 0}`,
      ],
      status: (production.sources?.organic_live || 0) >= 1 ? 'met' : 'incomplete',
    },
    {
      id: 'organic-token-reduction',
      requirement: 'Organic /work verify commands replayed on the descent ladder toward 1–2% of historical/L3 cold',
      evidence: [
        organicPf?.summary
          ? `hits=${organicPf.summary.ladder_hits}/${organicPf.summary.captured} live_hits=${organicPf.summary.live_ladder_hits} token_mult=${organicPf.summary.portfolio_multiplier} usd_mult=${organicPf.summary.session_usd_multiplier}`
          : 'no organic-portfolio artifact',
      ],
      status:
        organicPf?.summary?.target_met === true && (organicPf.summary.live_ladder_hits || 0) >= 1
          ? 'met'
          : organicPf?.summary?.target_met === true
            ? 'partial'
            : 'incomplete',
    },
    {
      id: 'live-session-usd-telemetry',
      requirement:
        'Live pack-root organic /work reports billed session USD multiplier (verify-replay vs cost_used; not new-feature sessions)',
      evidence: (() => {
        try {
          const { aggregateOrganicSessionUsd } = require('./lib/bench/session-usd-portfolio.cjs');
          const live = aggregateOrganicSessionUsd(root, root);
          return [
            `billed=${live.summary.billed_sessions} mult=${live.summary.session_usd_multiplier}`,
          ];
        } catch {
          return ['session-usd-portfolio unavailable'];
        }
      })(),
      status: (() => {
        try {
          const { aggregateOrganicSessionUsd } = require('./lib/bench/session-usd-portfolio.cjs');
          const live = aggregateOrganicSessionUsd(root, root);
          if (live.summary.billed_sessions >= 1 && live.summary.session_usd_multiplier != null) {
            return live.summary.usd_target_met === true ? 'met' : 'partial';
          }
          return (production.sources?.organic_live || 0) >= 1 ? 'partial' : 'incomplete';
        } catch {
          return 'incomplete';
        }
      })(),
    },
    {
      id: 'conversation-tool-descent',
      requirement:
        'Conversation tool traces (Read + isolated verify) evaluate and replay on the ladder toward 1–2% of L3 for that unit',
      evidence: [
        transcriptDescent
          ? `eval=${transcriptDescent.eval_status} ${transcriptDescent.first_tier}→${transcriptDescent.second_tier}→${transcriptDescent.third_tier} mult=${transcriptDescent.multiplier}`
          : 'no transcript-descent artifact',
      ],
      status: transcriptDescent?.target_met === true ? 'met' : 'incomplete',
    },
    {
      id: 'git-history-descent',
      requirement:
        'Git history (test co-changed with code) evaluates and skips LLM at implementation when design files overlap, toward 1–2% of L3 for that unit',
      evidence: [
        gitDescent
          ? `overlap=${gitDescent.overlap_source} skip=${gitDescent.skip_llm_exploration} tier=${gitDescent.tier} mult=${gitDescent.multiplier}`
          : 'no git-descent artifact',
      ],
      status: gitDescent?.target_met === true ? 'met' : 'incomplete',
    },
    {
      id: 'git-pack-history-descent',
      requirement:
        'This pack’s own git history mines isolated tests into an isolated store and skip_llm at implementation (not mutating committed procedures.json)',
      evidence: [
        gitPackDescent
          ? `declared=${gitPackDescent.declared_file} overlap=${gitPackDescent.overlap_source} skip=${gitPackDescent.skip_llm_exploration} mult=${gitPackDescent.multiplier}`
          : 'no git-pack-descent artifact',
      ],
      status: gitPackDescent?.target_met === true ? 'met' : 'incomplete',
    },
    {
      id: 'organic-worklog-descent',
      requirement:
        'Organic /work (declared files + isolated verify) skips LLM at implementation on a follow-up item with overlapping files, toward 1–2% of L3 for that unit',
      evidence: [
        organicDescent
          ? `overlap=${organicDescent.overlap_source} skip=${organicDescent.skip_llm_exploration} tier=${organicDescent.tier} mult=${organicDescent.multiplier}`
          : 'no organic-descent artifact',
      ],
      status: organicDescent?.target_met === true ? 'met' : 'incomplete',
    },
    {
      id: 'session-chunk-descent',
      requirement:
        'Session chunks (declared repo paths + isolated verify) evaluate and skip LLM at implementation toward 1–2% of L3 for that unit',
      evidence: [
        sessionMineDescent
          ? `overlap=${sessionMineDescent.overlap_source} skip=${sessionMineDescent.skip_llm_exploration} tier=${sessionMineDescent.tier} mult=${sessionMineDescent.multiplier}`
          : 'no session-mine-descent artifact',
      ],
      status: sessionMineDescent?.target_met === true ? 'met' : 'incomplete',
    },
    {
      id: 'implementation-skip-llm',
      requirement:
        'Implementation entry skip_llm_exploration on fingerprint L0/L1 (not verify-only), measured vs L3',
      evidence: [
        implEntry
          ? `skip=${implEntry.skip_llm_exploration} tier=${implEntry.tier} mult=${implEntry.multiplier}`
          : 'no implementation-entry artifact',
      ],
      status: implEntry?.target_met === true ? 'met' : 'incomplete',
    },
    {
      id: 'consumer-repo-learning',
      requirement:
        'Isolated consumer repo (projectRoot ≠ pack) learns organic /work, evolve-cycle memory, and skip_llm — not pack fixtures',
      evidence: [
        'scripts/bench/run-consumer-repo-descent.cjs',
        'scripts/fleet-onboard.cjs',
        'scripts/fleet-submit.cjs',
        consumerRepoDescent
          ? `memory=${consumerRepoDescent.memory_sqlite} skip=${consumerRepoDescent.skip_llm_exploration} evaluated=${consumerRepoDescent.project_skill_evaluated} mult=${consumerRepoDescent.multiplier}`
          : 'no consumer-repo-descent artifact',
      ],
      status: consumerRepoDescent?.target_met === true ? 'met' : 'incomplete',
    },
    {
      id: 'consumer-fleet-submission-gate',
      requirement:
        'Consumer repo submission gate passes with ≥3 organic_live /work items and portfolio ≤2% (isolated tmp — not fleet traffic)',
      evidence: [
        'scripts/bench/run-consumer-fleet-readiness.cjs',
        consumerFleetReadiness
          ? `organic_live=${consumerFleetReadiness.organic_live} ready=${consumerFleetReadiness.fleet_submission_ready} mult=${consumerFleetReadiness.portfolio_multiplier}`
          : 'no consumer-fleet-readiness artifact',
      ],
      status: consumerFleetReadiness?.target_met === true ? 'met' : 'incomplete',
    },
    {
      id: 'maintainer-dogfood-pipeline',
      requirement:
        'Maintainer dogfood fleet pipeline proven on real sibling consumer repos (excluded from fleet-scale counts)',
      evidence: [
        'scripts/fleet-consumer-bootstrap.cjs',
        'scripts/bench/run-fleet-archives-dogfood.cjs',
        `maintainer_dogfood=${fleetArchiveDetail.maintainer_dogfood_count}`,
        `archived_total=${fleetSummaryAll.archived}`,
      ],
      status: fleetArchiveDetail.maintainer_dogfood_count >= 3 ? 'met' : 'incomplete',
    },
    {
      id: 'fleet-scale-independent',
      requirement:
        'Independent fleet /work from consumer repos archived via fleet-submit → fleet-ingest-submission (not tmp benches)',
      evidence: [
        'scripts/fleet-submit.cjs',
        'scripts/ingest-fleet-submission.cjs',
        `archived_independent=${fleetSummary.archived_independent}`,
        `archived_total=${fleetSummaryAll.archived}`,
        `distinct_independent_consumers=${fleetSummary.distinct_independent_consumers}`,
        `maintainer_dogfood=${fleetArchiveDetail.maintainer_dogfood_count}`,
      ],
      status: fleetScaleGate.status,
    },
  ];

  const localRequirements = requirements.filter((r) => r.id !== 'fleet-scale-independent');
  const scorecardLocalMet = localRequirements.every((r) => r.status === 'met');
  const scorecardAllMet = requirements.every((r) => r.status === 'met');

  const payload = {
    generated_at: new Date().toISOString(),
    claim_status: claim,
    skills: { total: skills.length, unevaluated: unevaluated.length },
    production_tier_totals: {
      live: production.sources?.live ?? 0,
      fixtures: production.sources?.fixtures ?? 0,
      dogfood: production.sources?.dogfood ?? 0,
      organic: production.sources?.organic_live ?? production.sources?.organic ?? 0,
      organic_live: production.sources?.organic_live ?? 0,
      organic_fixtures: production.sources?.organic_fixtures ?? 0,
    },
    live_path: livePath
      ? {
          ok: livePath.ok === true,
          live_work_items: livePath.live_work_items || 0,
          live_production_verified: livePath.live_production_verified === true,
          measurement_contract: livePath.measurement_contract,
        }
      : null,
    requirements,
    unmet: requirements.filter((r) => r.status !== 'met').map((r) => r.id),
    scorecard_local_met: scorecardLocalMet,
    scorecard_all_met: scorecardAllMet,
    fleet_submissions: { ...fleetSummaryAll, fleet_scale: fleetSummary },
    fleet_archive_detail: fleetArchiveDetail,
    fleet_scale_progress: {
      independent_consumers: fleetSummary.distinct_independent_consumers,
      target: fleetScaleGate.target,
      fleet_scale_met: fleetScaleGate.met,
      maintainer_dogfood_consumers: listMaintainerDogfoodConsumerRoots(root),
      next_maintainer_actions: [
        'npm run fleet-share-kit -- --out-dir bench/results/fleet-share-kit',
        'Share kit with ≥3 external consumer teams (distinct repos, not maintainer_dogfood roots)',
        'Teams: fleet-onboard → ≥3 organic /work → fleet-submit (independent) → send fleet-submission.json',
        'Maintainer: npm run fleet-ingest-submission -- --submission fleet-submission.json',
      ],
    },
    goal_complete: scorecardAllMet,
    honesty: scorecardAllMet
      ? 'All objective requirements met including ≥3 independent fleet submissions at scale.'
      : 'goal_complete false until scorecard_all_met: local matrix plus ≥3 distinct independent fleet submissions (fleet_evidence_class=independent). maintainer_dogfood archives are excluded from fleet_scale counts. Fixture organic counts must not pad organic_live.',
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`objective-evidence: wrote ${outPath}`);
  console.log(`  claim_status: ${claim}`);
  console.log(`  unmet: ${payload.unmet.join(', ') || '(none)'}`);
  console.log(`  scorecard_local_met: ${payload.scorecard_local_met}`);
  console.log(`  scorecard_all_met: ${payload.scorecard_all_met}`);
  console.log(`  goal_complete: ${payload.goal_complete}`);
  process.exit(0);
}

main();
