#!/usr/bin/env node
/**
 * Golden eval harness for Agent Skills — runs deterministic corpus acceptance tests.
 *
 * Usage:
 *   node scripts/skill-eval.cjs run --skill <name> [--json]
 *   node scripts/skill-eval.cjs run --all [--promote] [--json]
 *   node scripts/skill-eval.cjs verify [--json]   # fail if any mapped skill is unevaluated or eval fails
 */
'use strict';

const path = require('node:path');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const {
  runGoldenEval,
  runAllGoldenEvals,
  loadGoldenEvalMap,
} = require('./lib/skills/golden-eval.cjs');
const { checkSkillEvalGate } = require('./lib/skills/eval-gate.cjs');
const {
  suggestSkillEvalFromProcedures,
  promoteRitualSkillCandidates,
  scaffoldMissingRitualSkills,
} = require('./lib/skills/skill-eval-suggestions.cjs');

function parseArgs(argv) {
  const out = { json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--plugin-root') out.pluginRoot = path.resolve(argv[++i]);
    else if (a === '--project-root') out.projectRoot = path.resolve(argv[++i]);
    else if (a === '--skill') out.skill = argv[++i];
    else if (a === '--all') out.all = true;
    else if (a === '--all-skills') {
      out.all = true;
      out.allSkills = true;
    }
    else if (a === '--promote') out.promote = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (!a.startsWith('-')) out.command = a;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const pluginRoot = args.pluginRoot || getDefaultPluginRoot();
  const projectRoot = args.projectRoot || process.cwd();
  const cmd = args.command || 'run';

  if (cmd === 'suggest') {
    const r = suggestSkillEvalFromProcedures({ projectRoot, pluginRoot });
    if (args.json) console.log(JSON.stringify(r, null, 2));
    else {
      console.log(`skill-eval suggest: ${r.ritual_skills} ritual skill(s), ${r.promote_candidates.length} promote candidate(s)`);
      for (const row of r.suggestions) {
        console.log(`  ${row.skill} [${row.action}] eval=${row.skill_eval_status} proc=${row.evaluated_procedures}/${row.unevaluated_procedures} — ${row.reason}`);
      }
    }
    process.exit(0);
  }

  if (cmd === 'scaffold-rituals') {
    const r = scaffoldMissingRitualSkills({ projectRoot, pluginRoot, dryRun: args.dryRun });
    if (args.json) console.log(JSON.stringify(r, null, 2));
    else {
      console.log(
        `skill-eval scaffold-rituals: ${r.created}/${r.total} created${args.dryRun ? ' (dry-run)' : ''}`
      );
    }
    process.exit(0);
  }

  if (cmd === 'promote-rituals') {
    const r = promoteRitualSkillCandidates({ projectRoot, pluginRoot, dryRun: args.dryRun });
    if (args.json) console.log(JSON.stringify(r, null, 2));
    else {
      console.log(
        `skill-eval promote-rituals: ${r.promoted}/${r.total} promoted${args.dryRun ? ' (dry-run)' : ''}`
      );
      for (const row of r.results.filter((x) => !x.ok)) {
        console.error(`  FAIL ${row.skill}: ${row.error || 'golden eval failed'}`);
      }
    }
    process.exit(r.ok ? 0 : 1);
  }

  if (cmd === 'run') {
  if (args.all) {
    const r = runAllGoldenEvals({ pluginRoot, promote: args.promote, allSkills: args.allSkills });
      if (args.json) console.log(JSON.stringify(r, null, 2));
      else {
        console.log(`skill-eval: ${r.passed}/${r.total} passed${args.promote ? ' (promoted)' : ''}`);
        for (const row of r.results.filter((x) => !x.ok)) {
          console.error(`  FAIL ${row.skill}: ${row.error || row.stderr || 'acceptance failed'}`);
        }
      }
      process.exit(r.ok ? 0 : 1);
    }
    if (!args.skill) {
      console.error('Usage: skill-eval.cjs run --skill <name> | --all [--promote]');
      process.exit(2);
    }
    const r = runGoldenEval({ pluginRoot, projectRoot, skillName: args.skill });
    if (args.json) console.log(JSON.stringify(r, null, 2));
    else console.log(r.ok ? `OK ${args.skill}` : `FAIL ${args.skill}: ${r.error || r.stderr}`);
    process.exit(r.ok ? 0 : 1);
  }

  if (cmd === 'verify') {
    const map = loadGoldenEvalMap(pluginRoot);
    const evalResult = runAllGoldenEvals({ pluginRoot, promote: false });
    const gateFails = [];
    for (const skillName of Object.keys(map)) {
      const gate = checkSkillEvalGate({ pluginRoot, skillName, autonomous: true });
      if (!gate.allowed && gate.eval_status === 'unevaluated') {
        gateFails.push(skillName);
      }
    }
    const out = {
      ok: evalResult.ok && gateFails.length === 0,
      golden_eval: evalResult,
      unevaluated_autonomous_blocked: gateFails,
    };
    if (args.json) console.log(JSON.stringify(out, null, 2));
    else {
      console.log(`golden eval: ${evalResult.passed}/${evalResult.total}`);
      if (gateFails.length) console.error(`unevaluated in map (expected evaluated after promote): ${gateFails.join(', ')}`);
    }
    process.exit(out.ok ? 0 : 1);
  }

  console.error('Usage: skill-eval.cjs run|verify|suggest|promote-rituals|scaffold-rituals');
  process.exit(2);
}

main();
