'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { openOrCreateDatabase, closeDatabase } = require('../memory/graph-store.cjs');
const { loadMergedMemoryConfig, sqlitePathForProject } = require('../memory/config.cjs');
const { buildFingerprint } = require('./fingerprint.cjs');
const { promoteOrDemote } = require('./promotion.cjs');
const { evalProcedureVerify, isolatedVerifyRel } = require('./procedure-eval.cjs');

const CMD_RE =
  /\b((?:npm|pnpm|yarn|npx|node)\s+[a-zA-Z0-9:/._\-\[\]"'= ]{2,120}|node\s+--test\s+\S+)/g;
const PATH_RE =
  /(?:^|[`\s(])((?:src|scripts|test|skills|hooks|docs|phases|config|bench)\/[\w./-]{2,120}\.[a-zA-Z0-9]{1,10})/g;

/**
 * Repo-relative paths mentioned in a session chunk that exist on disk.
 * @param {string} body
 * @param {string} projectRoot
 * @returns {string[]}
 */
function extractExistingRepoPaths(body, projectRoot) {
  const files = [];
  const seen = new Set();
  if (!body) return files;
  PATH_RE.lastIndex = 0;
  let m;
  while ((m = PATH_RE.exec(body)) !== null) {
    const rel = String(m[1]).replace(/[`)]+$/, '');
    if (seen.has(rel) || rel.includes('..')) continue;
    seen.add(rel);
    if (fs.existsSync(path.resolve(projectRoot, rel))) files.push(rel);
    if (files.length >= 8) break;
  }
  return files;
}

/**
 * Mine verify commands from session chunks in memory.sqlite.
 * @param {{ projectRoot: string, pluginRoot: string, limit?: number }} opts
 */
async function mineSessionProcedures(opts) {
  const projectRoot = opts.projectRoot;
  const pluginRoot = opts.pluginRoot;
  const merged = loadMergedMemoryConfig(pluginRoot, projectRoot);
  const sqlitePath = sqlitePathForProject(merged, projectRoot);

  const { db } = await openOrCreateDatabase(sqlitePath);
  const mined = new Map();
  try {
    const r = db.exec(
      "SELECT work_id, body FROM chunks WHERE (body LIKE '%npm %' OR body LIKE '%node %' OR body LIKE '%npx %') LIMIT 8000"
    );
    if (!r.length) return { ok: true, mined: 0, procedures: 0 };
    const rows = r[0].values;
    for (const [workId, body] of rows) {
      if (!body || typeof body !== 'string') continue;
      let m;
      CMD_RE.lastIndex = 0;
      while ((m = CMD_RE.exec(body)) !== null) {
        const cmd = m[1].trim().replace(/\s+/g, ' ');
        if (cmd.length < 6 || cmd.length > 120) continue;
        if (/password|secret|token|api[_-]?key/i.test(cmd)) continue;
        const key = `${workId || 'session'}::${cmd}`;
        if (!mined.has(key)) {
          mined.set(key, { workId: workId || 'session', command: cmd, body });
        }
      }
    }
  } finally {
    closeDatabase(db);
  }

  let procedures = 0;
  const limit = opts.limit || 40;
  const storeRoot = path.resolve(opts.storeRoot || projectRoot);
  for (const { workId, command: rawCommand, body } of [...mined.values()].slice(0, limit * 3)) {
    if (procedures >= limit) break;
    const readFiles = extractExistingRepoPaths(body || '', projectRoot);
    if (!readFiles.length) continue;
    let command = rawCommand;
    const isolatedFromCmd =
      isolatedVerifyRel(command, projectRoot) || isolatedVerifyRel(command, pluginRoot);
    const testFiles = readFiles.filter((f) => /\.(test|spec)\.(cjs|mjs|js)$/i.test(f));
    if (isolatedFromCmd) command = `node --test ${isolatedFromCmd}`;
    else if (testFiles.length) command = `node --test ${testFiles[0]}`;
    const isolatedRel = isolatedVerifyRel(command, projectRoot) || isolatedVerifyRel(command, pluginRoot);
    if (!isolatedRel) continue;
    const evalRoot = fs.existsSync(path.resolve(projectRoot, isolatedRel)) ? projectRoot : pluginRoot;
    const files = [...new Set(readFiles)].sort().slice(0, 24);
    const fp = buildFingerprint({ files, verifyCommand: command, failureSignature: '' });
    const procedure = {
      actions: files.map((p) => ({ type: 'READ_FILE', path: p })),
      verify: [{ type: 'RUN', command, cwd: evalRoot }],
      _meta: { source: 'session-mine', workId, read_files: files },
    };
    const evalPassed = evalProcedureVerify({ procedure, projectRoot: evalRoot }).ok === true;
    if (!evalPassed) continue;
    procedure._meta.eval_status = 'evaluated';
    promoteOrDemote({
      projectRoot: storeRoot,
      fingerprint: fp,
      procedure,
      evalPassed: true,
      humanApproved: false,
    });
    procedures++;
  }

  return { ok: true, mined: mined.size, procedures, sqlitePath };
}

module.exports = { mineSessionProcedures, extractExistingRepoPaths };
