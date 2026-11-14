'use strict';

/**
 * AE-038b — public-learning ingest requires auth_ref for private sources.
 * Refs ADR-012 / ADR-017; PD-53.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  isPrivateLearningSource,
  assertPublicLearningIngestAuthorized,
  ingestPrivateToPublicLearning,
  publicLearningAuditPath,
} = require('../scripts/lib/memory/public-learning-guard.cjs');
const { readLearningRecords } = require('../scripts/lib/memory/learning-store.cjs');

function makeLearning(id) {
  return {
    id,
    kind: 'tool.completed',
    work_id: 'work:ae038b',
    source_seq: 1,
    event_hash: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    evidence_refs: [
      {
        source_seq: 1,
        event_hash: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      },
    ],
    trust: 'untrusted',
    body: 'promoted lesson PUBLIC_LEARN_038b',
    ingested_at: '2026-11-14T14:00:00.000Z',
  };
}

describe('AE-038b public-learning auth_ref guard', () => {
  /** @type {string} */
  let tmp;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae038b-'));
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'ae038b', version: '1.0.0' })
    );
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('detects private/org sources that need auth_ref', () => {
    assert.equal(
      isPrivateLearningSource({ scope: 'organizational', visibility: 'private' }),
      true
    );
    assert.equal(
      isPrivateLearningSource({ scope: 'organizational', visibility: 'local', org_id: 'org:acme' }),
      true
    );
    assert.equal(
      isPrivateLearningSource({ scope: 'repository', visibility: 'public' }),
      false
    );
  });

  it('missing auth_ref fails closed for private source', () => {
    assert.throws(
      () =>
        assertPublicLearningIngestAuthorized({
          source: { id: 'mem:org:1', scope: 'organizational', visibility: 'private' },
        }),
      (err) => err && err.code === 'PUBLIC_LEARNING_AUTH_REF_REQUIRED'
    );
    assert.throws(
      () =>
        assertPublicLearningIngestAuthorized({
          source: { id: 'mem:org:1', scope: 'organizational', visibility: 'private' },
          auth_ref: '   ',
        }),
      (err) => err && err.code === 'PUBLIC_LEARNING_AUTH_REF_REQUIRED'
    );
  });

  it('with auth_ref allows ingest and writes audit', () => {
    const gate = assertPublicLearningIngestAuthorized({
      source: {
        id: 'mem:org:secret',
        scope: 'organizational',
        visibility: 'private',
        tenant_id: 'pilot-acme',
      },
      auth_ref: 'approval:ae038b-1',
      actor: 'user:founder',
    });
    assert.equal(gate.allowed, true);
    assert.equal(gate.auth_ref, 'approval:ae038b-1');
    assert.equal(gate.audit.auth_ref, 'approval:ae038b-1');
  });

  it('ingestPrivateToPublicLearning denies without auth_ref; allows with auth_ref + audit', () => {
    const source = {
      id: 'mem:org:private-lesson',
      scope: 'organizational',
      visibility: 'private',
      tenant_id: 'pilot-acme',
      org_id: 'org:acme',
      body: 'private only',
    };

    assert.throws(
      () =>
        ingestPrivateToPublicLearning(tmp, {
          source,
          learningRecord: makeLearning('learn:denied'),
        }),
      (err) => err && err.code === 'PUBLIC_LEARNING_AUTH_REF_REQUIRED'
    );

    const result = ingestPrivateToPublicLearning(tmp, {
      source,
      learningRecord: makeLearning('learn:ok'),
      auth_ref: 'approval:ae038b-2',
      actor: 'user:founder',
    });
    assert.equal(result.quarantined, false);
    assert.equal(result.record.auth_ref, 'approval:ae038b-2');

    const auditFile = publicLearningAuditPath(tmp);
    assert.ok(fs.existsSync(auditFile));
    const lines = fs.readFileSync(auditFile, 'utf8').trim().split('\n');
    assert.ok(lines.length >= 1);
    const last = JSON.parse(lines[lines.length - 1]);
    assert.equal(last.auth_ref, 'approval:ae038b-2');
    assert.equal(last.source_id, 'mem:org:private-lesson');
    assert.equal(last.action, 'private_to_public_learning');

    const live = readLearningRecords(tmp);
    assert.ok(live.some((r) => r.id === 'learn:ok'));
  });
});
