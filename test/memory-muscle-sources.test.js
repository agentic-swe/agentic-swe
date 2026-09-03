'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { projectFolderSlugs, discoverTranscriptSources } = require('../scripts/lib/memory/discover-transcripts.cjs');
const { extractBoldGuidelineConstraints, buildStyleProfile } = require('../scripts/lib/memory/style-profile.cjs');

describe('project-scoped transcript discovery', () => {
  it('encodes absolute paths as Cursor-style slugs', () => {
    const slugs = projectFolderSlugs('/Users/me/hobby-projects/agentic-labs');
    assert.ok(slugs.includes('Users-me-hobby-projects-agentic-labs'));
  });

  it('finds local sessions and extraDirs without walking all host projects', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'disc-tx-'));
    const sessions = path.join(tmp, '.agentic-swe', 'sessions');
    const extra = path.join(tmp, 'chats');
    fs.mkdirSync(sessions, { recursive: true });
    fs.mkdirSync(extra, { recursive: true });
    fs.writeFileSync(
      path.join(sessions, 'local.jsonl'),
      JSON.stringify({ role: 'user', text: 'Decision: keep transcripts project scoped for memory ingest.' }) + '\n'
    );
    fs.writeFileSync(
      path.join(extra, 'extra.jsonl'),
      JSON.stringify({ role: 'assistant', text: 'Lesson: do not ingest unrelated Cursor projects into this sqlite.' }) +
        '\n'
    );

    const r = discoverTranscriptSources(tmp, { extraDirs: [extra] });
    assert.equal(r.scoped, true);
    assert.ok(r.files.some((f) => f.endsWith('local.jsonl')));
    assert.ok(r.files.some((f) => f.endsWith('extra.jsonl')));
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('style profile extraction', () => {
  it('extracts bold em-dash guidelines from CLAUDE.md-shaped files', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'style-'));
    const claude = path.join(tmp, 'CLAUDE.md');
    fs.writeFileSync(
      claude,
      [
        '# Policy',
        '- **Human gates are mandatory** — Stop at ambiguity-wait.',
        '- **Source priority:** repo files then memory last.',
        '',
      ].join('\n')
    );
    const extracted = extractBoldGuidelineConstraints(claude);
    assert.ok(extracted.some((c) => /Human gates/i.test(c.text)));
    assert.ok(extracted.some((c) => /Source priority/i.test(c.text)));

    const profile = buildStyleProfile({ projectRoot: tmp, pluginRoot: tmp });
    assert.ok(profile.constraints.some((c) => /Human gates/i.test(c.text)));
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
