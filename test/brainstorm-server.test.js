/**
 * Integration test for tools/brainstorm-server (skipped if deps not installed).
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const serverDir = path.join(root, 'tools', 'brainstorm-server');
const serverReadyMarker = 'brainstorm-server listening';
const hasServerDeps = fs.existsSync(path.join(serverDir, 'node_modules', 'ws', 'package.json'));

function describeOrSkip(name, fn) {
  if (!hasServerDeps) {
    describe.skip(`${name} (install: cd tools/brainstorm-server && npm install)`, fn);
    return;
  }
  describe(name, fn);
}

describeOrSkip('brainstorm-server', () => {
  const port = 48721;
  let proc;

  before(async () => {
    proc = spawn(process.execPath, ['server.cjs', String(port)], {
      cwd: serverDir,
      env: {
        ...process.env,
        BRAINSTORM_PORT: String(port),
        BRAINSTORM_HOST: '127.0.0.1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server start timeout')), 8000);
      const onData = (chunk) => {
        if (String(chunk).includes(serverReadyMarker)) {
          clearTimeout(timer);
          proc.stdout.off('data', onData);
          resolve();
        }
      };
      proc.stdout.on('data', onData);
      proc.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      proc.on('exit', (code, sig) => {
        if (code && code !== 0) {
          clearTimeout(timer);
          reject(new Error(`server exited ${code} ${sig || ''}`));
        }
      });
    });
  });

  after(() => {
    if (proc && !proc.killed) {
      proc.kill('SIGTERM');
    }
  });

  it('accepts WebSocket connection and answers ping with pong', async () => {
    const WebSocket = require('ws');
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    const pongs = [];
    ws.on('message', (data) => {
      try {
        const o = JSON.parse(String(data));
        if (o.type === 'pong') pongs.push(o);
      } catch {
        /* ignore welcome etc. */
      }
    });
    ws.send(JSON.stringify({ type: 'ping' }));
    await new Promise((r) => setTimeout(r, 500));
    assert.ok(pongs.length >= 1, 'expected at least one pong');
    assert.strictEqual(pongs[0].type, 'pong');
    ws.close();
  });
});
