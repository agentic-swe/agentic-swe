'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { exportExecutionHistory } = require('./execution-history.cjs');
const { parseRitualPattern } = require('./procedure-ritual-skills.cjs');
const {
  extractActionsFromTranscriptFile,
  proceduresFromActionStream,
} = require('../descent/mine-transcript-procedures.cjs');

const EXTERNAL_SOURCE_RE = /external|fleet|import|foreign/i;

/**
 * @typedef {{
 *   kind: string,
 *   fingerprint?: string|null,
 *   journal_ref?: { work_id?: string, path?: string, seq?: number }|null,
 *   transcript_file?: string|null,
 *   verify_command?: string|null,
 *   source?: string|null,
 *   detail?: string|null
 * }} SourceEvidence
 */

/**
 * @typedef {{
 *   candidate_id: string,
 *   skill: string,
 *   kind: string,
 *   status: 'candidate',
 *   eval_status: 'unevaluated',
 *   verify_command: string,
 *   quarantined: boolean,
 *   quarantine_reason?: string|null,
 *   source_evidence: SourceEvidence[],
 *   autonomous_selection: false
 * }} SkillCandidate
 */

function stableCandidateId(skill, command, evidenceKey) {
  const h = createHash('sha256')
    .update(`${skill}\0${command}\0${evidenceKey}`)
    .digest('hex')
    .slice(0, 16);
  return `cand-${skill}-${h}`;
}

function isExternalProcedure(procRow) {
  if (procRow.external === true) return true;
  const src = String(procRow.source || procRow.procedure?._meta?.source || '');
  if (EXTERNAL_SOURCE_RE.test(src)) return true;
  if (procRow.eval_status === 'quarantined') return true;
  return false;
}

/**
 * Build skill candidates from an execution-history export (or project root).
 * External / fleet-imported procedures get `quarantined: true`. No network.
 *
 * @param {{
 *   projectRoot?: string,
 *   history?: ReturnType<typeof exportExecutionHistory>,
 *   includeUnevaluated?: boolean
 * }} opts
 */
function candidatesFromHistory(opts = {}) {
  const history =
    opts.history ||
    exportExecutionHistory({
      projectRoot: opts.projectRoot,
    });
  const includeUnevaluated = opts.includeUnevaluated !== false;
  /** @type {Map<string, SkillCandidate>} */
  const byKey = new Map();

  const journalByWork = new Map();
  for (const ref of history.journal_refs || []) {
    const list = journalByWork.get(ref.work_id) || [];
    list.push(ref);
    journalByWork.set(ref.work_id, list);
  }

  for (const row of history.procedures || []) {
    const command = row.verify_command || row.procedure?.verify?.[0]?.command || '';
    const pattern = parseRitualPattern(command);
    if (!pattern) continue;
    if (!includeUnevaluated && row.eval_status !== 'evaluated') continue;

    const quarantined = isExternalProcedure(row);
    const workId = row.procedure?._meta?.workId || row.procedure?._meta?.work_id || null;
    const journalHit = workId && journalByWork.get(String(workId))
      ? journalByWork.get(String(workId))[0]
      : (history.journal_refs || [])[0] || null;

    /** @type {SourceEvidence[]} */
    const source_evidence = [
      {
        kind: 'procedure',
        fingerprint: row.fingerprint || null,
        verify_command: command,
        source: row.source || row.procedure?._meta?.source || null,
        detail: row.eval_status || null,
      },
    ];
    if (journalHit) {
      source_evidence.push({
        kind: 'journal_ref',
        journal_ref: {
          work_id: journalHit.work_id,
          path: journalHit.path,
          seq: journalHit.seq,
        },
        detail: journalHit.type || null,
      });
    }

    const key = `${pattern.skill}::${command}::${quarantined ? 'q' : 'ok'}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.source_evidence.push(...source_evidence.filter(
        (e) => !existing.source_evidence.some(
          (x) => x.kind === e.kind && x.fingerprint === e.fingerprint && JSON.stringify(x.journal_ref) === JSON.stringify(e.journal_ref)
        )
      ));
      if (quarantined) {
        existing.quarantined = true;
        existing.quarantine_reason = existing.quarantine_reason || 'external_source';
      }
      continue;
    }

    byKey.set(key, {
      candidate_id: stableCandidateId(pattern.skill, command, row.fingerprint || command),
      skill: pattern.skill,
      kind: pattern.kind,
      status: 'candidate',
      eval_status: 'unevaluated',
      verify_command: command,
      quarantined,
      quarantine_reason: quarantined ? 'external_source' : null,
      source_evidence,
      autonomous_selection: false,
    });
  }

  return {
    ok: true,
    candidates: [...byKey.values()].sort((a, b) => a.skill.localeCompare(b.skill) || a.candidate_id.localeCompare(b.candidate_id)),
    procedure_count: (history.procedures || []).length,
    journal_ref_count: (history.journal_refs || []).length,
  };
}

/**
 * Derive candidates from a transcript JSONL fixture (offline; does not write procedures).
 * @param {{ projectRoot: string, transcriptPath: string, quarantineExternal?: boolean }} opts
 */
function candidatesFromTranscript(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const transcriptPath = path.resolve(opts.transcriptPath);
  if (!fs.existsSync(transcriptPath)) {
    return { ok: false, code: 'TRANSCRIPT_MISSING', candidates: [] };
  }

  const actions = extractActionsFromTranscriptFile(transcriptPath, projectRoot);
  const procs = proceduresFromActionStream(actions);
  const basename = path.basename(transcriptPath);
  /** @type {SkillCandidate[]} */
  const candidates = [];

  for (const proc of procs) {
    const command = proc.verify?.[0]?.command || '';
    const pattern = parseRitualPattern(command);
    if (!pattern) continue;

    const metaSource = proc._meta?.source || 'transcript-tools';
    const quarantined =
      opts.quarantineExternal === true ||
      EXTERNAL_SOURCE_RE.test(String(metaSource)) ||
      EXTERNAL_SOURCE_RE.test(basename);

    /** @type {SourceEvidence[]} */
    const source_evidence = [
      {
        kind: 'transcript',
        transcript_file: basename,
        verify_command: command,
        source: metaSource,
        detail: (proc.actions || []).map((a) => a.path).filter(Boolean).join(',') || null,
      },
    ];

    candidates.push({
      candidate_id: stableCandidateId(pattern.skill, command, basename),
      skill: pattern.skill,
      kind: pattern.kind,
      status: 'candidate',
      eval_status: 'unevaluated',
      verify_command: command,
      quarantined,
      quarantine_reason: quarantined ? 'external_source' : null,
      source_evidence,
      autonomous_selection: false,
    });
  }

  return {
    ok: true,
    candidates: candidates.sort((a, b) => a.skill.localeCompare(b.skill)),
    actions: actions.length,
    procedures_seen: procs.length,
  };
}

/**
 * End-to-end: export history (optional) + transcript fixture → candidates.
 * @param {{
 *   projectRoot: string,
 *   transcriptPath?: string,
 *   history?: object
 * }} opts
 */
function discoverSkillCandidates(opts) {
  const fromHistory = candidatesFromHistory({
    projectRoot: opts.projectRoot,
    history: opts.history,
  });
  let fromTranscript = { ok: true, candidates: [] };
  if (opts.transcriptPath) {
    fromTranscript = candidatesFromTranscript({
      projectRoot: opts.projectRoot,
      transcriptPath: opts.transcriptPath,
    });
  }

  const byId = new Map();
  for (const c of [...fromHistory.candidates, ...fromTranscript.candidates]) {
    const prev = byId.get(c.candidate_id);
    if (!prev) {
      byId.set(c.candidate_id, c);
      continue;
    }
    prev.source_evidence = [...prev.source_evidence, ...c.source_evidence];
    if (c.quarantined) {
      prev.quarantined = true;
      prev.quarantine_reason = prev.quarantine_reason || c.quarantine_reason;
    }
  }

  return {
    ok: true,
    candidates: [...byId.values()].sort((a, b) => a.skill.localeCompare(b.skill)),
    from_history: fromHistory.candidates.length,
    from_transcript: fromTranscript.candidates.length,
  };
}

module.exports = {
  candidatesFromHistory,
  candidatesFromTranscript,
  discoverSkillCandidates,
  isExternalProcedure,
  stableCandidateId,
};
