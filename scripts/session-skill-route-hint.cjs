#!/usr/bin/env node
/**
 * Emit skill-route hints for active work (with unevaluated flagging).
 * Used by hooks/session-start. Opt out: AGENTIC_SWE_SKILL_ROUTE_HINT=0
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { discoverActiveWorkDir } = require('./lib/work-engine/discover-workdir.cjs');
const { routeSkillsWithMemory } = require('./lib/skills/skill-router.cjs');
const { resolvePrimeQuery } = require('./lib/memory/resolve-prime-query.cjs');
const { suggestSkillEvalFromProcedures } = require('./lib/skills/skill-eval-suggestions.cjs');
const { checkMuscleMemoryReadiness } = require('./lib/work-engine/muscle-memory-doctor.cjs');
const { appendFleetConsumerHints } = require('./lib/fleet/session-fleet-hints.cjs');
const { adviseSkillNouls, appendJevSkillLines } = require('./lib/jev/rerank.cjs');

function parseArgs(argv) {
  const args = argv.slice(2);
  let projectRoot = process.cwd();
  let pluginRoot = path.join(__dirname, '..');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project-root' && args[i + 1]) {
      projectRoot = path.resolve(args[++i]);
      continue;
    }
    if (args[i] === '--plugin-root' && args[i + 1]) {
      pluginRoot = path.resolve(args[++i]);
      continue;
    }
  }
  return { projectRoot, pluginRoot };
}

async function main() {
  const v = process.env.AGENTIC_SWE_SKILL_ROUTE_HINT;
  if (v === '0' || v === 'false' || v === 'off') return;

  const { projectRoot, pluginRoot } = parseArgs(process.argv);
  const consumerMode = path.resolve(projectRoot) !== path.resolve(pluginRoot);
  let workDir = process.env.AGENTIC_SWE_WORK_DIR
    ? path.resolve(process.env.AGENTIC_SWE_WORK_DIR)
    : discoverActiveWorkDir(projectRoot);

  let query = process.env.AGENTIC_SWE_SKILL_ROUTE_QUERY || '';
  if (!query && workDir) {
    query = resolvePrimeQuery({ projectRoot, workDir, pluginRoot }) || '';
  }

  const lines = [];

  if (consumerMode && !query.trim()) {
    const doctor = checkMuscleMemoryReadiness({ projectRoot, pluginRoot });
    appendFleetConsumerHints(lines, {
      projectRoot,
      pluginRoot,
      muscleMemoryOk: doctor.ok,
    });
    if (lines.length) process.stdout.write(`${lines.join('\n')}\n`);
    return;
  }

  if (!query.trim()) return;

  const r = await routeSkillsWithMemory({ pluginRoot, projectRoot, query, k: 4 });
  let skillJev = null;
  try {
    const advised = await adviseSkillNouls({
      pluginRoot,
      projectRoot,
      query,
      results: r.results,
      workDir,
      env: process.env,
    });
    skillJev = advised.jev;
  } catch {
    skillJev = { skipped: 'http_error', applied: false, fallback: 'lexical' };
  }

  let muscle = [];
  try {
    const { loadStore } = require('./lib/descent/promotion.cjs');
    const { extractDeclaredFiles } = require('./lib/scope/diff-scope-check.cjs');
    const { findOverlappingEvaluatedProcedure, procedureVerifyCommand } = require('./lib/descent/overlap-procedure.cjs');
    const storeRoot = fs.existsSync(path.join(projectRoot, '.agentic-swe', 'procedures.json'))
      ? projectRoot
      : pluginRoot;
    const data = loadStore(storeRoot);
    const q = query.toLowerCase();
    if (workDir) {
      const declared =
        extractDeclaredFiles(path.join(workDir, 'design.md')) ||
        extractDeclaredFiles(path.join(workDir, 'implementation.md'));
      const files = declared && declared.size ? [...declared] : [];
      const overlap = files.length ? findOverlappingEvaluatedProcedure(storeRoot, files) : null;
      if (overlap) {
        muscle.push({
          tier: overlap.tier,
          command: String(procedureVerifyCommand(overlap) || '').slice(0, 80),
          eval_status: overlap.eval_status,
          note: overlap.procedure?._meta?.source || 'overlap',
        });
      }
    }
    for (const p of data.procedures || []) {
      if (p.eval_status === 'unevaluated') continue;
      const cmd = p.procedure?.verify?.[0]?.command || '';
      if (!cmd) continue;
      if (!/test|verify|check/i.test(q) && !/test|verify/.test(cmd)) continue;
      if (muscle.some((m) => m.command === cmd.slice(0, 80))) continue;
      muscle.push({ tier: p.tier, command: cmd.slice(0, 80), eval_status: p.eval_status });
      if (muscle.length >= 4) break;
    }
  } catch {
    muscle = [];
  }

  const wid = workDir ? path.basename(workDir) : null;

  if (r.results.length) {
    lines.push('### Skill route (runtime discovery)', '');
    lines.push(wid ? `- **Work item:** \`${wid}\`` : '- **Work item:** (none active)');
    lines.push(`- **Query:** ${JSON.stringify(query.slice(0, 120))}`, '');
    for (const row of r.results) {
      const ritual =
        row.memory_boost >= 2.5 ? ' procedure-ritual' : row.memory_boost > 0 ? ' memory' : '';
      const flag = row.flag ? ` — **${row.flag}**` : '';
      lines.push(
        `- \`${row.name}\` [${row.eval_status}] score=${row.score.toFixed(2)}${row.memory_boost ? ` memory+${row.memory_boost}${ritual}` : ''}${flag}`
      );
    }
    if (r.unevaluated_in_top_k > 0) {
      lines.push('');
      lines.push(
        `- ⚠ **${r.unevaluated_in_top_k}** unevaluated skill(s) in top-${r.results.length} — use \`work-engine skill-check --skill <name>\` before autonomous invocation.`
      );
    }
    appendJevSkillLines(lines, skillJev);
  }

  if (muscle.length) {
    lines.push('');
    lines.push('### Muscle memory (evaluated procedures)');
    lines.push('');
    for (const m of muscle) {
      lines.push(`- **${m.tier}** \`${m.command}\` [${m.eval_status}]${m.note ? ` (${m.note})` : ''}`);
    }
  }

  const skillEval = suggestSkillEvalFromProcedures({ projectRoot, pluginRoot });
  const promote = skillEval.promote_candidates || [];
  const scaffold = skillEval.scaffold_candidates || [];
  const evaluateFirst = (skillEval.suggestions || []).filter((s) => s.action === 'evaluate_procedure_first');
  if (promote.length || scaffold.length || evaluateFirst.length) {
    lines.push('');
    lines.push('### Skill eval (procedure rituals)');
    lines.push('');
    if (promote.length) {
      lines.push(
        `- **${promote.length}** skill(s) ready for \`npm run skill-eval -- promote-rituals --project-root ${projectRoot}\`: \`${promote.join('`, `')}\``
      );
    }
    if (scaffold.length) {
      lines.push(
        `- **${scaffold.length}** missing skill(s) — \`npm run skill-eval -- scaffold-rituals --project-root ${projectRoot}\`: \`${scaffold.join('`, `')}\``
      );
    }
    for (const row of evaluateFirst.slice(0, 3)) {
      lines.push(
        `- \`${row.skill}\` — evaluate procedure verify first (${row.unevaluated_procedures} unevaluated ritual(s))`
      );
    }
  }

  if (consumerMode) {
    const doctor = checkMuscleMemoryReadiness({ projectRoot, pluginRoot });
    appendFleetConsumerHints(lines, {
      projectRoot,
      pluginRoot,
      muscleMemoryOk: doctor.ok,
    });
  }

  if (!lines.length) return;

  process.stdout.write(`${lines.join('\n')}\n`);
}

main().catch(() => process.exit(0));
