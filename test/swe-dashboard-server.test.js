'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '..');
const serverScript = path.join(root, 'scripts', 'swe-dashboard-server.cjs');

describe('swe-dashboard-server', () => {
  it('GET /api/work-items returns JSON from .worklogs', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-dashsrv-'));
    fs.mkdirSync(path.join(tmp, '.worklogs', 'x'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.worklogs', 'x', 'state.json'),
      JSON.stringify({
        schema_version: 2,
        work_id: 'x',
        task: 't',
        current_state: 'initialized',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T01:00:00.000Z',
        timeout_at: '2026-01-02T00:00:00.000Z',
        owner: 'o',
        mode: 'full',
        resume: {},
        budget: { iteration_budget: 5, budget_remaining: 5, cost_budget_usd: 1, cost_used: 0 },
        counters: {},
        ambiguity: { detected: false, notes: [], resolved: false },
        approvals: { pr_approved: false, changes_requested: false },
        metrics: { tests_passed: false },
        risk: { level: 'unknown', score: null, top_items: [] },
        artifacts: {},
        validation: {},
        git: {},
        pipeline: {},
        convergence: {},
        history: [],
      }),
      'utf8'
    );

    const port = 43100 + Math.floor(Math.random() * 2000);
    const child = spawn(process.execPath, [serverScript, '--cwd', tmp, '--port', String(port), '--no-open'], {
      cwd: root,
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    const base = `http://127.0.0.1:${port}`;
    async function waitForUp() {
      for (let i = 0; i < 80; i++) {
        try {
          await new Promise((resolve, reject) => {
            http
              .get(`${base}/api/work-items`, (res) => {
                res.resume();
                res.on('end', resolve);
              })
              .on('error', reject);
          });
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      throw new Error('dashboard server did not become ready');
    }

    try {
      await waitForUp();

      const body = await new Promise((resolve, reject) => {
        http
          .get(`${base}/api/work-items`, (res) => {
            let d = '';
            res.on('data', (c) => {
              d += c;
            });
            res.on('end', () => resolve(d));
          })
          .on('error', reject);
      });
      const j = JSON.parse(body);
      assert.strictEqual(j.items.length, 1);
      assert.strictEqual(j.items[0].work_id, 'x');
      assert.strictEqual(j.rollup.work_item_count, 1);
      assert.strictEqual(j.total_count, 1);
      assert.strictEqual(j.items[0].work_dir_relative, '.worklogs/x');
      assert.strictEqual(j.items[0].state_json_abs_path, path.join(tmp, '.worklogs', 'x', 'state.json'));

      const metaBody = await new Promise((resolve, reject) => {
        http
          .get(`${base}/api/meta`, (res) => {
            let d = '';
            res.on('data', (c) => {
              d += c;
            });
            res.on('end', () => resolve(d));
          })
          .on('error', reject);
      });
      const meta = JSON.parse(metaBody);
      assert.strictEqual(meta.projectRoot, path.resolve(tmp));

      const roll = await new Promise((resolve, reject) => {
        const req = http.request(
          `${base}/api/rollup`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' } },
          (res) => {
            let d = '';
            res.on('data', (c) => {
              d += c;
            });
            res.on('end', () => resolve(JSON.parse(d)));
          },
        );
        req.on('error', reject);
        req.write(JSON.stringify({ items: j.items.filter((i) => !i.error) }));
        req.end();
      });
      assert.strictEqual(roll.rollup.work_item_count, 1);
    } finally {
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 200));
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
