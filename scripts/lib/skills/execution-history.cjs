'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadStore } = require('../memory/procedure-store.cjs');

function collectJournalRefs(projectRoot, opts) {
  opts = opts || {};
  const root = path.resolve(projectRoot);
  const worklogs = path.join(root, '.worklogs');
  const refs = [];
  if (!fs.existsSync(worklogs)) return refs;

  const maxFiles = opts.maxFiles || 64;
  const maxEvents = opts.maxEventsPerFile || 200;
  let filesSeen = 0;
  let entries;
  try {
    entries = fs.readdirSync(worklogs, { withFileTypes: true });
  } catch (_err) {
    return refs;
  }

  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith('_') || ent.name.startsWith('.')) continue;
    const journalPath = path.join(worklogs, ent.name, 'journal.jsonl');
    if (!fs.existsSync(journalPath)) continue;
    if (filesSeen >= maxFiles) break;
    filesSeen += 1;

    let raw;
    try {
      raw = fs.readFileSync(journalPath, 'utf8');
    } catch (_err) {
      continue;
    }
    const lines = raw.split('\n');
    let count = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      if (count >= maxEvents) break;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch (_err) {
        continue;
      }
      if (obj == null || typeof obj !== 'object') continue;
      const seq = Number(obj.seq);
      if (!Number.isFinite(seq) || seq < 1) continue;
      const stateWorkId = obj.state && obj.state.work_id;
      refs.push({
        work_id: String(stateWorkId || ent.name),
        path: path.relative(root, journalPath).split(path.sep).join('/'),
        seq: seq,
        type: obj.type != null ? String(obj.type) : undefined,
        hash: obj.hash != null ? String(obj.hash) : undefined,
        at: obj.at != null ? String(obj.at) : undefined,
      });
      count += 1;
    }
  }

  return refs.sort(function (a, b) {
    return a.work_id.localeCompare(b.work_id) || a.seq - b.seq || a.path.localeCompare(b.path);
  });
}

function exportExecutionHistory(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const data = loadStore(projectRoot);
  const procedures = Array.isArray(data.procedures) ? data.procedures : [];
  const journal_refs = collectJournalRefs(projectRoot, {
    maxFiles: opts.maxJournalFiles,
    maxEventsPerFile: opts.maxJournalEventsPerFile,
  });

  return {
    ok: true,
    project_root: projectRoot,
    exported_at: new Date().toISOString(),
    procedure_count: procedures.length,
    procedures: procedures.map(function (p) {
      const meta = p.procedure && p.procedure._meta;
      const verify = p.procedure && p.procedure.verify && p.procedure.verify[0];
      return {
        fingerprint: p.fingerprint,
        tier: p.tier || null,
        eval_status: p.eval_status || null,
        external: Boolean(p.external),
        source: p.source || (meta && meta.source) || null,
        scope: p.scope || null,
        verify_command: (verify && verify.command) || null,
        procedure: p.procedure || null,
        human_approved: Boolean(p.human_approved),
        auto_confirmed: Boolean(p.auto_confirmed),
      };
    }),
    journal_refs: journal_refs,
    journal_ref_count: journal_refs.length,
  };
}

module.exports = {
  exportExecutionHistory: exportExecutionHistory,
  collectJournalRefs: collectJournalRefs,
};
