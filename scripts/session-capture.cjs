#!/usr/bin/env node
/**
 * Capture session transcript tail on Stop/compact, redact, distill typed nodes, index chunks.
 * Chains chunk indexing → procedure mining (self-evolution) when enabled.
 * Invoked from hooks/hooks.json Stop (best-effort; failures ignored).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const { discoverActiveWorkDir } = require('./lib/work-engine/discover-workdir.cjs');
const { openOrCreateDatabase, persistDatabase, closeDatabase, ensureChunksSchema } = require('./lib/memory/graph-store.cjs');
const { loadMergedMemoryConfig, sqlitePathForProject } = require('./lib/memory/config.cjs');
const { distillSessionChunk, upsertTypedNodes, redactSecrets } = require('./lib/memory/session-capture.cjs');
const {
  parseTranscriptFile,
  insertSessionChunk,
  textFromJsonlLine,
} = require('./lib/memory/session-ingest.cjs');
const { newestTranscriptFile } = require('./lib/memory/discover-transcripts.cjs');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--transcript-path') out.transcriptPath = argv[++i];
    else if (a === '--project-root') out.projectRoot = path.resolve(argv[++i]);
    else if (a === '--plugin-root') out.pluginRoot = path.resolve(argv[++i]);
    else if (a === '--json') out.json = true;
    else if (a === '--no-evolve') out.noEvolve = true;
  }
  return out;
}

function readTranscriptTail(transcriptPath, maxLines = 120) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return '';
  const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');
  const tail = lines.slice(-maxLines);
  const texts = [];
  for (const line of tail) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      const t = textFromJsonlLine(obj);
      if (t.trim()) texts.push(t);
    } catch {
      texts.push(line);
    }
  }
  return texts.join('\n');
}

function ingestTranscriptTailChunks(db, transcriptPath, maxLines = 80) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return { chunks: 0, blocked: 0 };
  const raw = fs.readFileSync(transcriptPath, 'utf8');
  const lines = raw.split('\n');
  const tailLines = lines.slice(-maxLines).join('\n');
  const tmpPath = path.join(path.dirname(transcriptPath), `.tail-${process.pid}.jsonl`);
  fs.writeFileSync(tmpPath, tailLines, 'utf8');
  try {
    const sessionId = path.basename(transcriptPath, '.jsonl');
    const { turns } = parseTranscriptFile(tmpPath, maxLines);
    let chunks = 0;
    let blocked = 0;
    for (let i = 0; i < turns.length; i++) {
      const t = turns[i];
      const { redacted, hits } = redactSecrets(t.text);
      if (hits > 0 && redacted.trim().length < 40) {
        blocked++;
        continue;
      }
      insertSessionChunk(db, {
        sessionId,
        turnIdx: lines.length - turns.length + i + 1,
        role: t.role,
        body: redacted.slice(0, 8000),
      });
      chunks++;
    }
    return { chunks, blocked };
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
  }
}

function readHookStdin() {
  if (process.stdin.isTTY) return {};
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const hook = args.transcriptPath ? {} : readHookStdin();
  const projectRoot =
    args.projectRoot ||
    process.env.AGENTIC_SWE_PROJECT_ROOT ||
    hook.cwd ||
    (Array.isArray(hook.workspace_roots) && hook.workspace_roots[0]) ||
    process.cwd();
  const pluginRoot = args.pluginRoot || getDefaultPluginRoot();
  const transcriptPath =
    args.transcriptPath ||
    process.env.CLAUDE_TRANSCRIPT_PATH ||
    process.env.TRANSCRIPT_PATH ||
    hook.transcript_path ||
    hook.transcriptPath ||
    newestTranscriptFile(projectRoot);

  const workDir = process.env.AGENTIC_SWE_WORK_DIR
    ? path.resolve(process.env.AGENTIC_SWE_WORK_DIR)
    : discoverActiveWorkDir(projectRoot);
  const workId = workDir ? path.basename(workDir) : null;

  const text = readTranscriptTail(transcriptPath);
  if (!text.trim() && !transcriptPath) {
    if (args.json) console.log(JSON.stringify({ ok: true, skipped: 'empty transcript' }));
    return;
  }

  const distilled = distillSessionChunk({ text, workId, source: 'stop-hook' });
  if (distilled.blocked) {
    if (args.json) console.log(JSON.stringify({ ok: false, blocked: true, redaction_hits: distilled.redaction_hits }));
    process.exit(0);
  }

  const merged = loadMergedMemoryConfig(pluginRoot, projectRoot);
  const sqlitePath = sqlitePathForProject(merged, projectRoot);
  const { db } = await openOrCreateDatabase(sqlitePath);
  let chunkStats = { chunks: 0, blocked: 0 };
  try {
    ensureChunksSchema(db);
    if (transcriptPath) {
      chunkStats = ingestTranscriptTailChunks(db, transcriptPath);
    }
    if (distilled.nodes.length) {
      upsertTypedNodes(db, distilled.nodes);
    }
    persistDatabase(db, sqlitePath);
  } finally {
    closeDatabase(db);
  }

  let evolve = null;
  const runEvolve = !args.noEvolve && process.env.AGENTIC_SWE_EVOLVE_ON_STOP !== '0';
  if (runEvolve) {
    try {
      const { runEvolveCycle } = require('./evolve-cycle.cjs');
      const promoteEnv = process.env.AGENTIC_SWE_PROMOTE_RITUALS || '';
      const scaffoldEnv = process.env.AGENTIC_SWE_SCAFFOLD_RITUALS || '';
      const evolveSkillsEnv = process.env.AGENTIC_SWE_EVOLVE_SKILLS || '';
      const fullEvolve =
        evolveSkillsEnv === '1' || evolveSkillsEnv === 'true' || evolveSkillsEnv === 'dry-run';
      evolve = await runEvolveCycle({
        projectRoot,
        pluginRoot,
        limit: Number(process.env.AGENTIC_SWE_EVOLVE_LIMIT || 5),
        promoteRituals:
          fullEvolve ||
          promoteEnv === '1' ||
          promoteEnv === 'true' ||
          promoteEnv === 'dry-run',
        scaffoldRituals:
          fullEvolve ||
          scaffoldEnv === '1' ||
          scaffoldEnv === 'true' ||
          scaffoldEnv === 'dry-run',
        dryRun:
          evolveSkillsEnv === 'dry-run' ||
          promoteEnv === 'dry-run' ||
          scaffoldEnv === 'dry-run',
      });
    } catch {
      /* best-effort */
    }
  }

  const out = {
    ok: true,
    nodes: distilled.nodes.length,
    chunks: chunkStats.chunks,
    redaction_hits: distilled.redaction_hits,
    work_id: workId,
    evolve,
  };
  if (args.json) console.log(JSON.stringify(out, null, 2));

  if (path.resolve(projectRoot) !== path.resolve(pluginRoot)) {
    try {
      const { writeFleetStatusSnapshot } = require('./lib/fleet/fleet-status-snapshot.cjs');
      const { checkMuscleMemoryReadiness } = require('./lib/work-engine/muscle-memory-doctor.cjs');
      const doctor = checkMuscleMemoryReadiness({ projectRoot, pluginRoot });
      writeFleetStatusSnapshot({
        projectRoot,
        pluginRoot,
        muscleMemoryOk: doctor.ok,
        source: 'session-capture',
      });
    } catch {
      /* best-effort */
    }
  }
}

main().catch(() => process.exit(0));
