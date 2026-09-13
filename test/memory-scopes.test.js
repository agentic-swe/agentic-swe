'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { appendLocalEvent } = require('../scripts/lib/sync/git-sync.cjs');
const { ingestTeamEvents, ingestPersonalProfile, ingestGitTeamHistory, ingestMuscleReplayWorklogs, parseGitLogNameOnly } = require('../scripts/lib/memory/ingest-scopes.cjs');
const { sqlitePathForScope } = require('../scripts/lib/memory/scopes.cjs');
const { runMemoryIndex } = require('../scripts/lib/memory/memory-pipeline.cjs');
const { ingestTranscripts } = require('../scripts/lib/memory/session-ingest.cjs');
const { buildPrimeMarkdown } = require('../scripts/lib/memory/memory-prime.cjs');

const pluginRoot = path.resolve(__dirname, '..');

describe('memory scopes: repo + session + team + personal', () => {
  it('ingests all four sources and search hits team + personal', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-scopes-'));
    const personal = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-personal-'));
    const prevPersonal = process.env.AGENTIC_SWE_PERSONAL_ROOT;
    process.env.AGENTIC_SWE_PERSONAL_ROOT = personal;

    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'scope-fixture', version: '1.0.0' }));
      fs.writeFileSync(path.join(tmp, 'README.md'), '# fixture\nmuscle memory repo docs\n');

      await runMemoryIndex({ projectRoot: tmp, pluginRoot });

      const transcript = path.join(tmp, 'chat.jsonl');
      fs.writeFileSync(
        transcript,
        JSON.stringify({
          type: 'assistant',
          message: { role: 'assistant', content: 'Decision: always run npm test after session ingest.' },
        }) + '\n'
      );
      const session = await ingestTranscripts({
        projectRoot: tmp,
        pluginRoot,
        transcriptPaths: [transcript],
      });
      assert.ok(session.chunks >= 1);

      appendLocalEvent({
        projectRoot: tmp,
        event: { kind: 'lesson', label: 'team sync lesson: prefer descent-first', scope: 'team' },
      });
      const team = await ingestTeamEvents({ projectRoot: tmp, pluginRoot });
      assert.equal(team.events, 1);

      const personalIngest = await ingestPersonalProfile({ projectRoot: tmp, pluginRoot });
      assert.ok(personalIngest.constraints >= 3);
      assert.ok(fs.existsSync(sqlitePathForScope('personal', { pluginRoot, projectRoot: tmp })));

      const teamSearch = spawnSync(
        process.execPath,
        [
          path.join(pluginRoot, 'scripts/memory-search.cjs'),
          '--project-root',
          tmp,
          '--plugin-root',
          pluginRoot,
          '--scope',
          'team',
          '--query',
          'descent',
          '--json',
        ],
        { encoding: 'utf8', env: { ...process.env, AGENTIC_SWE_PERSONAL_ROOT: personal } }
      );
      assert.equal(teamSearch.status, 0, teamSearch.stderr);
      const teamPayload = JSON.parse(teamSearch.stdout);
      assert.match(teamPayload.markdown, /descent/i);

      const personalSearch = spawnSync(
        process.execPath,
        [
          path.join(pluginRoot, 'scripts/memory-search.cjs'),
          '--project-root',
          tmp,
          '--plugin-root',
          pluginRoot,
          '--scope',
          'personal',
          '--query',
          'style',
          '--json',
        ],
        { encoding: 'utf8', env: { ...process.env, AGENTIC_SWE_PERSONAL_ROOT: personal } }
      );
      assert.equal(personalSearch.status, 0, personalSearch.stderr);
      const personalPayload = JSON.parse(personalSearch.stdout);
      assert.match(personalPayload.markdown, /style/i);
    } finally {
      if (prevPersonal === undefined) delete process.env.AGENTIC_SWE_PERSONAL_ROOT;
      else process.env.AGENTIC_SWE_PERSONAL_ROOT = prevPersonal;
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.rmSync(personal, { recursive: true, force: true });
    }
  });

  it('parses git log --name-only headers and file lists', () => {
    const hash = 'a'.repeat(40);
    const raw = `${hash}\tAda\tfix verify path\nsrc/hit.js\n\n${'b'.repeat(40)}\tBob\tother\nREADME.md\n`;
    const commits = parseGitLogNameOnly(raw, 10);
    assert.equal(commits.length, 2);
    assert.equal(commits[0].subject, 'fix verify path');
    assert.deepEqual(commits[0].files, ['src/hit.js']);
  });

  it('ingests git history and muscle replay into the project graph', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-git-'));
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'git-fixture', version: '1.0.0' }));
      fs.writeFileSync(path.join(tmp, 'README.md'), '# git fixture prefer descent-first\n');
      await runMemoryIndex({ projectRoot: tmp, pluginRoot });
      const init = spawnSync('git', ['init'], { cwd: tmp, encoding: 'utf8' });
      assert.equal(init.status, 0, init.stderr);
      spawnSync('git', ['add', '.'], { cwd: tmp, encoding: 'utf8' });
      const commit = spawnSync(
        'git',
        ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-m', 'prefer descent-first replay'],
        { cwd: tmp, encoding: 'utf8' }
      );
      assert.equal(commit.status, 0, commit.stderr);
      const gitTeam = await ingestGitTeamHistory({ projectRoot: tmp, pluginRoot });
      assert.ok(gitTeam.commits >= 1, gitTeam.reason);
      const prime = await buildPrimeMarkdown({ projectRoot: tmp, pluginRoot });
      assert.match(prime, /Team memory/);
      assert.match(prime, /descent-first/);

      const workDir = path.join(tmp, '.worklogs', 'w-replay');
      fs.mkdirSync(workDir, { recursive: true });
      fs.writeFileSync(path.join(workDir, 'descent-replay.md'), '# Descent replay\n\n**Result:** PASS (zero-LLM pack replay)\n');
      fs.writeFileSync(
        path.join(workDir, 'context-pack.json'),
        JSON.stringify({ muscle_memory: [{ tier: 'L0', command: 'node -e "process.exit(0)"' }] })
      );
      const muscle = await ingestMuscleReplayWorklogs({ projectRoot: tmp, pluginRoot });
      assert.equal(muscle.work_items, 1);

      const search = spawnSync(
        process.execPath,
        [
          path.join(pluginRoot, 'scripts/memory-search.cjs'),
          '--project-root',
          tmp,
          '--plugin-root',
          pluginRoot,
          '--scope',
          'team',
          '--query',
          'descent-first',
          '--json',
        ],
        { encoding: 'utf8' }
      );
      assert.equal(search.status, 0, search.stderr);
      assert.match(JSON.parse(search.stdout).markdown, /descent-first/i);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
