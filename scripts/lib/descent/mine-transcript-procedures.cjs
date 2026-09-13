'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { discoverTranscriptSources } = require('../memory/discover-transcripts.cjs');
const { buildFingerprint } = require('./fingerprint.cjs');
const { promoteOrDemote } = require('./promotion.cjs');
const { evalProcedureVerify, isolatedVerifyRel } = require('./procedure-eval.cjs');

function repoRelativeExisting(absOrRel, projectRoot) {
  if (!absOrRel) return null;
  const root = path.resolve(projectRoot);
  const abs = path.isAbsolute(absOrRel) ? absOrRel : path.resolve(root, absOrRel);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  if (!fs.existsSync(abs)) return null;
  return rel.split(path.sep).join('/');
}

function isDangerousCommand(cmd) {
  return /password|secret|token|api[_-]?key|\brm\s+-rf\b|\bsudo\b|curl\s+[^\n]*\|/i.test(cmd);
}

/**
 * Commands that can serve as procedure verify (how this session actually checked work).
 * @param {string} cmd
 */
function isVerifyCommand(cmd) {
  const t = String(cmd || '').trim();
  if (!t || t.length > 160 || isDangerousCommand(t)) return false;
  if (/[;&|]/.test(t)) return false;
  if (/^(npm|pnpm|yarn)\s+(test|run\s+(test|verify|ci|test:smoke))\b/.test(t)) return true;
  if (/^node\s+test\//.test(t)) return true;
  if (/^node\s+--test\s+test\//.test(t)) return true;
  return false;
}

/**
 * Map a Cursor/Claude tool_use part to a replayable typed action, or null.
 * Writes/edits are never replayed from transcripts.
 * @param {object} p
 * @param {string} projectRoot
 */
function mapToolUseToAction(p, projectRoot) {
  if (!p || p.type !== 'tool_use') return null;
  const name = String(p.name || '');
  const inp = p.input || {};
  if (/^(Read|read_file)$/i.test(name)) {
    const rel = repoRelativeExisting(inp.path, projectRoot);
    if (!rel) return null;
    return { type: 'READ_FILE', path: rel };
  }
  if (/^Grep$/i.test(name) && inp.pattern) {
    const rel = inp.path ? repoRelativeExisting(inp.path, projectRoot) : null;
    return { type: 'SEARCH', pattern: String(inp.pattern).slice(0, 120), path: rel || '.' };
  }
  if (/^Glob$/i.test(name) && (inp.pattern || inp.glob_pattern)) {
    return { type: 'GLOB', pattern: String(inp.pattern || inp.glob_pattern).slice(0, 120) };
  }
  if (/^(Shell|Bash)$/i.test(name) && inp.command) {
    const command = String(inp.command).replace(/\s+/g, ' ').trim();
    if (!isVerifyCommand(command)) return null;
    return { type: 'RUN', command };
  }
  return null;
}

function contentPartsFromLine(obj) {
  if (!obj || typeof obj !== 'object') return [];
  const c = obj.message?.content ?? obj.content;
  return Array.isArray(c) ? c : [];
}

/**
 * Ordered replayable actions from a transcript JSONL file.
 * @param {string} filePath
 * @param {string} projectRoot
 * @param {number} [maxLines]
 */
function extractActionsFromTranscriptFile(filePath, projectRoot, maxLines = 2000) {
  const actions = [];
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n').slice(0, maxLines);
  for (const line of lines) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    for (const part of contentPartsFromLine(obj)) {
      const a = mapToolUseToAction(part, projectRoot);
      if (a) actions.push(a);
    }
  }
  return actions;
}

/**
 * Collapse Read* then verify-RUN into procedure candidates.
 * @param {object[]} actions
 */
function proceduresFromActionStream(actions) {
  const out = [];
  const reads = [];
  for (const a of actions) {
    if (a.type === 'READ_FILE') {
      if (!reads.some((r) => r.path === a.path)) reads.push(a);
      if (reads.length > 8) reads.shift();
      continue;
    }
    if (a.type === 'RUN' && isVerifyCommand(a.command)) {
      out.push({
        actions: reads.slice(),
        verify: [{ type: 'RUN', command: a.command }],
      });
    }
  }
  return out;
}

/**
 * Mine L1 (usually unevaluated) procedures from host transcripts' actual tool traces.
 * @param {{ projectRoot: string, pluginRoot?: string, limit?: number, extraDirs?: string[] }} opts
 */
function mineTranscriptProcedures(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const discovered = discoverTranscriptSources(projectRoot, { extraDirs: opts.extraDirs });
  const files = discovered.files.slice(0, opts.maxFiles || 24);
  const seen = new Set();
  let procedures = 0;
  let sequences = 0;
  const limit = opts.limit || 40;

  for (const file of files) {
    let actions;
    try {
      actions = extractActionsFromTranscriptFile(file, projectRoot);
    } catch {
      continue;
    }
    for (const proc of proceduresFromActionStream(actions)) {
      sequences++;
      const command = proc.verify[0].command;
      const filesFp = proc.actions.map((a) => a.path).filter(Boolean);
      const fpFiles = filesFp.length ? filesFp : ['transcript-verify'];
      const key = `${fpFiles.join('|')}::${command}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (procedures >= limit) break;
      const fp = buildFingerprint({ files: fpFiles, verifyCommand: command, failureSignature: '' });
      const procedure = {
        ...proc,
        _meta: { source: 'transcript-tools', file: path.basename(file) },
      };
      const isolated = isolatedVerifyRel(command, projectRoot);
      let evalPassed = false;
      if (isolated) {
        evalPassed = evalProcedureVerify({ procedure, projectRoot }).ok === true;
      }
      procedure._meta.eval_status = evalPassed ? 'evaluated' : 'unevaluated';
      promoteOrDemote({
        projectRoot,
        fingerprint: fp,
        procedure,
        evalPassed,
        humanApproved: false,
      });
      procedures++;
    }
    if (procedures >= limit) break;
  }

  return {
    ok: true,
    mined: sequences,
    procedures,
    files_scanned: files.length,
    dirs: discovered.dirs.length,
  };
}

module.exports = {
  mineTranscriptProcedures,
  extractActionsFromTranscriptFile,
  proceduresFromActionStream,
  mapToolUseToAction,
  isVerifyCommand,
  repoRelativeExisting,
};
