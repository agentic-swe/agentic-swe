'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { translateActionsForAllHosts } = require('../scripts/lib/runtime/hosts.cjs');
const { delegateBriefFromPack, replayContextPack } = require('../scripts/lib/context/delegate-from-pack.cjs');

describe('host-agnostic context pack translation', () => {
  it('maps the same typed actions onto Claude, Cursor, Codex, and Gemini tools', () => {
    const pack = {
      scope: 'w1 implementation',
      constraints: ['skip_llm_exploration is set — do not re-derive'],
      scope_files: [{ path: 'src/hit.js', lines: 'all', purpose: 'design' }],
      muscle_memory: [{ tier: 'L0', command: 'node -e "process.exit(0)"' }],
    };
    const { byHost, markdown, actions } = delegateBriefFromPack(pack);
    assert.ok(actions.some((a) => a.type === 'READ_FILE'));
    assert.ok(actions.some((a) => a.type === 'RUN'));
    const all = translateActionsForAllHosts(actions);
    assert.equal(all['claude-code'][0].tool, 'Read');
    assert.equal(all.cursor[0].tool, 'Read');
    assert.equal(all.codex[0].tool, 'read_file');
    assert.equal(all.gemini[0].tool, 'read_file');
    assert.equal(all.opencode[0].tool, 'opencode.file.read');
    const runIdx = actions.findIndex((a) => a.type === 'RUN');
    assert.equal(actions.filter((a) => a.type === 'RUN').length, 1);
    assert.equal(all['claude-code'][runIdx].tool, 'Bash');
    assert.equal(all.cursor[runIdx].tool, 'Shell');
    assert.equal(all.codex[runIdx].tool, 'shell');
    assert.equal(all.gemini[runIdx].tool, 'run_shell_command');
    assert.equal(all.opencode[runIdx].tool, 'opencode.shell.exec');
    assert.deepEqual(byHost['claude-code'], all['claude-code']);
    assert.match(markdown, /skip_llm/);
    assert.match(markdown, /claude-code/);
  });

  it('session-context-pack-hint prints a brief when the work item has a pack', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-hint-'));
    const workDir = path.join(tmp, '.worklogs', 'w1');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, 'state.json'), JSON.stringify({ current_state: 'implementation' }));
    fs.writeFileSync(
      path.join(workDir, 'context-pack.json'),
      JSON.stringify({
        scope: 'w1',
        constraints: ['skip_llm_exploration is set'],
        scope_files: [{ path: 'src/a.js' }],
        muscle_memory: [{ tier: 'L0', command: 'node -e "process.exit(0)"' }],
      })
    );
    const r = spawnSync(
      process.execPath,
      [path.join(__dirname, '..', 'scripts/session-context-pack-hint.cjs'), '--project-root', tmp],
      { encoding: 'utf8', env: { ...process.env, AGENTIC_SWE_WORK_DIR: workDir } }
    );
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Context pack/);
    assert.match(r.stdout, /cursor/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('replays only the primary verify command, not every muscle_memory row', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-replay-'));
    fs.writeFileSync(path.join(tmp, 'ok.js'), 'module.exports = 1;\n');
    const pack = {
      scope: 'w',
      scope_files: [{ path: 'ok.js' }],
      verification_commands: [{ check: 'x', command: 'node -e "process.exit(0)"', expected: '0' }],
      muscle_memory: [
        { tier: 'L0', command: 'node -e "process.exit(0)"' },
        { tier: 'L0', command: 'node -e "process.exit(99)"' },
      ],
    };
    const r = replayContextPack({ pack, projectRoot: tmp });
    assert.equal(r.ok, true, r.reason);
    assert.equal(r.steps.filter((s) => s.action.type === 'RUN').length, 1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('replay-context-pack CLI writes descent-replay.md', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-cli-'));
    const workDir = path.join(tmp, '.worklogs', 'w1');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(tmp, 'ok.js'), 'module.exports = 1;\n');
    fs.writeFileSync(
      path.join(workDir, 'context-pack.json'),
      JSON.stringify({
        scope: 'w1',
        scope_files: [{ path: 'ok.js' }],
        verification_commands: [{ check: 'x', command: 'node -e "process.exit(0)"', expected: '0' }],
      })
    );
    const r = spawnSync(
      process.execPath,
      [
        path.join(__dirname, '..', 'scripts/replay-context-pack.cjs'),
        '--work-dir',
        workDir,
        '--project-root',
        tmp,
        '--json',
      ],
      { encoding: 'utf8' }
    );
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok(fs.existsSync(path.join(workDir, 'descent-replay.md')));
    assert.match(fs.readFileSync(path.join(workDir, 'descent-replay.md'), 'utf8'), /PASS/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
