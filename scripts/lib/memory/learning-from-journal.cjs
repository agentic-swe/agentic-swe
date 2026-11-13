'use strict';

/**
 * AE-031a — journal → learning subscriber.
 * Maps tool.completed, transition, and usage.recorded events into LearningRecords
 * with source_seq + event_hash on every record. Zero network. Refs ADR-011, ADR-012.
 */

const fs = require('node:fs');
const path = require('node:path');
const { readJournal, verifyJournalText } = require('../shared/journal.cjs');
const {
  LEARNING_KINDS,
  learningRecordFromJournalEvent,
} = require('./learning-record.cjs');
const { writeLearningBundle, learningStorePath } = require('./learning-store.cjs');

const LEARNING_KIND_SET = new Set(LEARNING_KINDS);

/**
 * @param {object[]} events
 * @param {{ workId?: string, ingestedAt?: string }} [opts]
 * @returns {object[]}
 */
function recordsFromEvents(events, opts = {}) {
  const out = [];
  for (const event of events || []) {
    if (!event || !LEARNING_KIND_SET.has(String(event.type || ''))) continue;
    out.push(learningRecordFromJournalEvent(event, opts));
  }
  return out;
}

/**
 * Ingest a work journal into the project learning store.
 * @param {{ workDir: string, projectRoot: string, workId?: string, ingestedAt?: string }} opts
 * @returns {{ records: object[], storePath: string, sourceEvents: number }}
 */
function ingestJournalToLearning(opts) {
  const workDir = path.resolve(opts.workDir);
  const projectRoot = path.resolve(opts.projectRoot);
  const chain = readJournal(workDir);
  if (!chain.ok) {
    const err = new Error(
      `journal integrity failed: ${chain.reason || 'unknown'} (seq=${chain.seq || '?'})`
    );
    err.code = 'INTEGRITY_FAILED';
    err.seq = chain.seq;
    throw err;
  }
  const workId =
    opts.workId ||
    (chain.events.find((e) => e.state && e.state.work_id) || {}).state?.work_id ||
    path.basename(workDir);
  const records = recordsFromEvents(chain.events, {
    workId,
    ingestedAt: opts.ingestedAt,
  });
  // Every record must carry source_seq (acceptance).
  for (const rec of records) {
    if (!Number.isInteger(rec.source_seq) || rec.source_seq < 1) {
      const err = new Error('learning record missing source_seq');
      err.code = 'MISSING_SOURCE_SEQ';
      err.path = 'source_seq';
      throw err;
    }
    if (!rec.event_hash) {
      const err = new Error('learning record missing event_hash');
      err.code = 'MISSING_EVENT_HASH';
      err.path = 'event_hash';
      throw err;
    }
  }
  writeLearningBundle(projectRoot, records);
  return {
    records,
    storePath: learningStorePath(projectRoot),
    sourceEvents: chain.events.length,
  };
}

/**
 * Build a learning bundle from a journal JSONL file (fixture path).
 * Does not write to disk unless projectRoot is provided.
 * @param {string} journalFile
 * @param {{ workId?: string, projectRoot?: string, ingestedAt?: string }} [opts]
 */
function learningBundleFromJournalFile(journalFile, opts = {}) {
  const text = fs.readFileSync(path.resolve(journalFile), 'utf8');
  const chain = verifyJournalText(text);
  if (!chain.ok) {
    const err = new Error(
      `fixture journal integrity failed: ${chain.reason || 'unknown'}`
    );
    err.code = 'INTEGRITY_FAILED';
    throw err;
  }
  const records = recordsFromEvents(chain.events, {
    workId: opts.workId || 'fixture',
    ingestedAt: opts.ingestedAt || '2020-01-01T00:00:00.000Z',
  });
  if (opts.projectRoot) {
    writeLearningBundle(path.resolve(opts.projectRoot), records);
  }
  return { records, head: chain.head, sourceEvents: chain.events.length };
}

module.exports = {
  recordsFromEvents,
  ingestJournalToLearning,
  learningBundleFromJournalFile,
};
