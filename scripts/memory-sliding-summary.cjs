#!/usr/bin/env node
/**
 * Build sliding-summary.md from a Claude Code JSONL transcript (deterministic + optional LLM).
 *
 * Usage:
 *   node scripts/memory-sliding-summary.cjs --work-dir /abs/.worklogs/<id> --transcript-path /abs/transcript.jsonl [--llm] [--json]
 *
 * Env: OPENAI_API_KEY when --llm; AGENTIC_SWE_SLIDING_SUMMARY_MODEL (optional).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const { loadMergedMemoryConfig } = require('./lib/memory/config.cjs');
const {
  parseTranscriptTurns,
  buildSlidingSummaryMarkdown,
} = require('./lib/memory/transcript-sliding.cjs');

function parseArgs(argv) {
  const out = { json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--llm') out.llm = true;
    else if (a === '--work-dir') out.workDir = path.resolve(argv[++i]);
    else if (a === '--transcript-path') out.transcriptPath = path.resolve(argv[++i]);
    else if (a === '--plugin-root') out.pluginRoot = path.resolve(argv[++i]);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.workDir || !args.transcriptPath) {
    console.error('memory-sliding-summary: required --work-dir and --transcript-path');
    process.exit(2);
  }
  if (!fs.existsSync(args.transcriptPath)) {
    console.error(`memory-sliding-summary: transcript not found: ${args.transcriptPath}`);
    process.exit(1);
  }

  const pluginRoot = args.pluginRoot || getDefaultPluginRoot();
  const projectRoot = path.resolve(args.workDir, '..', '..');
  const merged = loadMergedMemoryConfig(pluginRoot, projectRoot);
  const sliding = merged.sliding || {};

  const turns = parseTranscriptTurns(args.transcriptPath);
  const md = await buildSlidingSummaryMarkdown(turns, {
    recentVerbatim: sliding.recent_turns_verbatim != null ? sliding.recent_turns_verbatim : 8,
    maxOldChars: sliding.max_old_turn_chars != null ? sliding.max_old_turn_chars : 240,
    useLlm: args.llm === true || sliding.llm_enabled === true,
    llmModel: sliding.llm_model,
  });

  const outName =
    typeof sliding.output_filename === 'string' && sliding.output_filename.length > 0
      ? sliding.output_filename
      : 'sliding-summary.md';
  const outPath = path.join(args.workDir, outName);
  fs.writeFileSync(outPath, md, 'utf8');

  if (args.json) {
    console.log(JSON.stringify({ ok: true, outputPath: outPath, turns: turns.length }, null, 2));
    return;
  }
  console.log(`memory-sliding-summary: wrote ${outPath} (${turns.length} turns)`);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
