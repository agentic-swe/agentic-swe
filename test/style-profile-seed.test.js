'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildStyleProfile,
  writeStyleProfile,
  extractFromSessionFiles,
  extractFromWorklogs,
  extractFromDocsPlans,
  extractFromChangelog,
  extractFromBranchWorkflow,
} = require('../scripts/lib/memory/style-profile.cjs');

describe('style profile corpus seeding', () => {
  it('mines sessions, worklogs, plans, CHANGELOG, and branch workflow with provenance', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'style-seed-'));
    const sessionsDir = path.join(tmp, '.agentic-swe', 'sessions');
    const workDir = path.join(tmp, '.worklogs', 'feat-demo');
    const plansDir = path.join(tmp, 'docs/plans');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.mkdirSync(workDir, { recursive: true });
    fs.mkdirSync(plansDir, { recursive: true });

    fs.writeFileSync(
      path.join(sessionsDir, 'prior.jsonl'),
      [
        JSON.stringify({
          role: 'user',
          text: 'Decision: never copy competitor code into this repository.',
        }),
        JSON.stringify({
          role: 'assistant',
          text: 'Lesson: ask before git add unless the user explicitly requested a commit.',
        }),
      ].join('\n') + '\n'
    );

    fs.writeFileSync(
      path.join(workDir, 'reflection-log.md'),
      [
        '- **What failed**: tests missed edge case',
        '- **Root cause**: scope creep beyond the task boundary',
        '- **Strategy change**: keep changes minimal and task-scoped',
      ].join('\n')
    );

    fs.writeFileSync(
      path.join(plansDir, '2026-demo-plan.md'),
      [
        '# Demo plan',
        '> **Decision locked with human:** evolve the paradigm first.',
        'Rename to agentic-loops executed as a later phase, co-launched with the goal loop.',
      ].join('\n')
    );

    fs.writeFileSync(
      path.join(tmp, 'CHANGELOG.md'),
      '### Changed\n- **Git workflow:** removed the **`uat`** line for this repo — topic branches open PRs directly to `main`.\n'
    );
    fs.writeFileSync(
      path.join(tmp, 'docs/branch-workflow.md'),
      '**Do not run `git add`** until the user has confirmed what should be staged.\nOnly `@surajSFDC` should merge.\n'
    );
    fs.writeFileSync(
      path.join(tmp, 'CLAUDE.md'),
      '- **Human gates are mandatory** — Stop at ambiguity-wait.\n'
    );

    const sessionFile = path.join(sessionsDir, 'prior.jsonl');
    const sessionHits = extractFromSessionFiles([sessionFile]);
    assert.ok(sessionHits.some((c) => /competitor code/i.test(c.text)));
    assert.ok(sessionHits.some((c) => /git add/i.test(c.text)));

    const worklogHits = extractFromWorklogs(path.join(tmp, '.worklogs'));
    assert.ok(worklogHits.some((c) => /scope creep|task-scoped/i.test(c.text)));

    const planHits = extractFromDocsPlans(plansDir);
    assert.ok(planHits.some((c) => /paradigm first/i.test(c.text)));
    assert.ok(planHits.some((c) => /agentic-loops rename/i.test(c.text)));

    assert.ok(extractFromChangelog(path.join(tmp, 'CHANGELOG.md')).some((c) => /uat/i.test(c.text)));
    assert.ok(extractFromBranchWorkflow(path.join(tmp, 'docs/branch-workflow.md')).some((c) => /git add/i.test(c.text)));

    const profile = buildStyleProfile({
      projectRoot: tmp,
      pluginRoot: tmp,
      sessionFiles: [sessionFile],
    });
    assert.ok(profile.constraints.length >= 8);
    assert.ok(profile.generated_at);
    assert.ok(profile.sources.sessions >= 1);
    assert.ok(profile.sources.worklogs >= 1);
    assert.ok(profile.sources['docs/plans'] >= 1);
    assert.ok(profile.constraints.every((c) => c.provenance && c.text && c.id));

    writeStyleProfile(tmp, profile);
    const written = JSON.parse(fs.readFileSync(path.join(tmp, '.agentic-swe', 'style-profile.json'), 'utf8'));
    assert.equal(written.constraints.length, profile.constraints.length);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('builds a non-empty profile for the pack repository', () => {
    const root = path.join(__dirname, '..');
    const profile = buildStyleProfile({ projectRoot: root, pluginRoot: root, sessionFiles: [] });
    assert.ok(profile.constraints.length >= 5);
    assert.ok(profile.sources['CLAUDE.md'] >= 1 || profile.sources['repo-convention'] >= 1);
  });
});
