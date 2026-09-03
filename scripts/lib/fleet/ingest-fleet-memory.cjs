'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { openOrCreateDatabase, persistDatabase, closeDatabase, ensureChunksSchema } = require('../memory/graph-store.cjs');
const { loadMergedMemoryConfig, sqlitePathForProject } = require('../memory/config.cjs');
const { upsertTypedNodes } = require('../memory/session-capture.cjs');
const { makeChunkId } = require('../memory/chunk-split.cjs');

function submissionDigest(submissionPath) {
  return crypto.createHash('sha256').update(fs.readFileSync(submissionPath)).digest('hex').slice(0, 12);
}

function findArchiveByDigest(pluginRoot, digest) {
  const dir = path.join(pluginRoot, 'bench', 'results', 'fleet-submissions');
  if (!fs.existsSync(dir)) return null;
  const suffix = `-${digest}.json`;
  const hit = fs.readdirSync(dir).find((f) => f.endsWith(suffix));
  return hit ? path.join(dir, hit) : null;
}

function buildFleetMemoryBody(submission, archiveRel) {
  const evidence = submission.evidence || {};
  const readiness = evidence.submission_readiness || submission;
  const procedures = evidence.procedures || {};
  const git = submission.git || {};
  const lines = [
    `fleet submission ingested: ${path.basename(submission.project_root || 'consumer')}`,
    `fleet_evidence_class: ${submission.fleet_evidence_class || 'independent'}`,
    `consumer_project_root: ${submission.project_root || '?'}`,
    `organic_live: ${readiness.organic_live ?? '?'}`,
    `tier_totals_work_items: ${readiness.tier_totals_work_items ?? '?'}`,
    `portfolio_multiplier: ${readiness.portfolio_multiplier ?? '?'}`,
    `procedures_evaluated: ${procedures.evaluated ?? '?'}`,
    `ritual_skills: ${(procedures.ritual_skills || []).join(', ') || 'none'}`,
    `archive: ${archiveRel}`,
  ];
  if (git.origin) lines.push(`git_origin: ${git.origin}`);
  if (git.head) lines.push(`git_head: ${git.head}`);
  const verifySamples = procedures.verify_samples || [];
  if (verifySamples.length) {
    lines.push(`verify_samples: ${verifySamples.join(' | ')}`);
  }
  return lines.join('\n');
}

/**
 * Index fleet submission signals into maintainer team memory graph.
 * @param {{ submission: object, pluginRoot: string, archivePath: string }} opts
 */
async function ingestFleetSubmissionMemory(opts) {
  const pluginRoot = path.resolve(opts.pluginRoot);
  const submission = opts.submission;
  const archivePath = path.resolve(opts.archivePath);
  const archiveRel = path.relative(pluginRoot, archivePath);
  const merged = loadMergedMemoryConfig(pluginRoot, pluginRoot);
  const sqlitePath = sqlitePathForProject(merged, pluginRoot);
  const body = buildFleetMemoryBody(submission, archiveRel);
  const digest = crypto.createHash('sha256').update(body).digest('hex').slice(0, 12);
  const chunkPath = `bench/results/fleet-submissions/${path.basename(archivePath)}#memory`;

  const { db } = await openOrCreateDatabase(sqlitePath);
  try {
    ensureChunksSchema(db);
    const chunkId = makeChunkId(chunkPath, 1, 1, body);
    const sha = crypto.createHash('sha256').update(body).digest('hex');
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO chunks (chunk_id, path, work_id, start_line, end_line, content_sha256, body)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run([chunkId, chunkPath, 'team', 1, 1, sha, body]);
    stmt.free();
    upsertTypedNodes(db, [
      {
        id: `fleet:${digest}`,
        kind: 'fleet-submission',
        label: `fleet ${submission.fleet_evidence_class || 'independent'}: ${path.basename(submission.project_root || 'consumer')}`,
        body,
      },
    ]);
    persistDatabase(db, sqlitePath);
  } finally {
    closeDatabase(db);
  }

  return { ok: true, sqlitePath, chunk_path: chunkPath };
}

function listArchiveSubmissionPaths(pluginRoot) {
  const dir = path.join(path.resolve(pluginRoot), 'bench', 'results', 'fleet-submissions');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(dir, f));
}

/**
 * Re-index all archived fleet submissions into maintainer team memory (idempotent).
 * @param {string} pluginRoot
 */
async function syncArchivedFleetSubmissionsMemory(pluginRoot) {
  const root = path.resolve(pluginRoot);
  const paths = listArchiveSubmissionPaths(root);
  let synced = 0;
  const errors = [];
  for (const archivePath of paths) {
    let submission;
    try {
      submission = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
    } catch (e) {
      errors.push({ archive: path.basename(archivePath), error: e.message || String(e) });
      continue;
    }
    try {
      await ingestFleetSubmissionMemory({ submission, pluginRoot: root, archivePath });
      synced++;
    } catch (e) {
      errors.push({ archive: path.basename(archivePath), error: e.message || String(e) });
    }
  }
  return { ok: errors.length === 0, synced, total: paths.length, errors };
}

module.exports = {
  submissionDigest,
  findArchiveByDigest,
  buildFleetMemoryBody,
  ingestFleetSubmissionMemory,
  listArchiveSubmissionPaths,
  syncArchivedFleetSubmissionsMemory,
};
