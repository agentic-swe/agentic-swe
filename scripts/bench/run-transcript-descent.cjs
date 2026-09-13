#!/usr/bin/env node
/**
 * Conversation → muscle memory → ladder: mine a Cursor-shaped transcript
 * (Read + isolated node --test), eval the verify, replay L0/L1 vs L3 estimate.
 *
 * This is a closed-loop unit of work (re-run the same isolated test), not a
 * claim that a greenfield design session costs 1–2%.
 *
 * Usage:
 *   node scripts/bench/run-transcript-descent.cjs [--out bench/results/transcript-descent-<date>.json]
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getDefaultPluginRoot } = require('../lib/work-engine/engine.cjs');
const { mineTranscriptProcedures } = require('../lib/descent/mine-transcript-procedures.cjs');
const { tryDescentLadder, loadTierTokenEstimates } = require('../lib/descent/ladder.cjs');
const { loadStore } = require('../lib/descent/promotion.cjs');

const TARGET = 0.02;

async function main() {
  const pluginRoot = getDefaultPluginRoot();
  const date = new Date().toISOString().slice(0, 10);
  const outIdx = process.argv.indexOf('--out');
  const outPath =
    outIdx >= 0
      ? process.argv[outIdx + 1]
      : path.join(pluginRoot, 'bench', 'results', `transcript-descent-${date}.json`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-descent-'));
  const testRel = 'test/ok.test.js';
  fs.mkdirSync(path.join(tmp, 'test'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, testRel),
    `'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
describe('ok', () => { it('passes', () => assert.equal(1, 1)); });
`
  );
  const chats = path.join(tmp, 'chats');
  fs.mkdirSync(chats, { recursive: true });
  const absTest = path.join(tmp, testRel);
  const verify = `node --test ${testRel}`;
  fs.writeFileSync(
    path.join(chats, 'session.jsonl'),
    JSON.stringify({
      role: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Re-running the isolated acceptance test from this session.' },
          { type: 'tool_use', name: 'Read', input: { path: absTest } },
          { type: 'tool_use', name: 'Shell', input: { command: verify } },
        ],
      },
    }) + '\n'
  );

  const mined = mineTranscriptProcedures({ projectRoot: tmp, extraDirs: [chats], limit: 8 });
  const store = loadStore(tmp);
  const rec = store.procedures.find((p) => p.procedure?._meta?.source === 'transcript-tools');

  const first = await tryDescentLadder({
    projectRoot: tmp,
    pluginRoot,
    files: [testRel],
    verifyCommand: verify,
    cwd: tmp,
  });
  const second = await tryDescentLadder({
    projectRoot: tmp,
    pluginRoot,
    files: [testRel],
    verifyCommand: verify,
    cwd: tmp,
  });

  const third = await tryDescentLadder({
    projectRoot: tmp,
    pluginRoot,
    files: [testRel],
    verifyCommand: verify,
    cwd: tmp,
  });

  const estimates = loadTierTokenEstimates(pluginRoot);
  const delivered = Number.isFinite(third.delivered_tokens)
    ? third.delivered_tokens
    : second.delivered_tokens;
  const cold = estimates.L3;
  const multiplier = cold > 0 ? delivered / cold : 1;
  const evalStatus = rec?.eval_status || 'missing';

  const payload = {
    generated_at: new Date().toISOString(),
    ok: mined.ok === true && first.ok === true && evalStatus === 'evaluated',
    measurement_contract:
      'Isolated node --test from a conversation tool trace, evaluated then replayed. Not a full-session USD claim.',
    mined,
    eval_status: evalStatus,
    first_tier: first.tier,
    second_tier: second.tier,
    third_tier: third.tier,
    delivered_tokens: delivered,
    cold_l3_tokens: cold,
    multiplier,
    target_multiplier: TARGET,
    target_met: first.ok === true && evalStatus === 'evaluated' && multiplier <= TARGET,
  };

  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`transcript-descent: wrote ${outPath}`);
  console.log(
    `  eval=${evalStatus} ${first.tier}→${second.tier}→${third.tier} ${delivered}/${cold} tokens (${(multiplier * 100).toFixed(3)}%) target_met=${payload.target_met}`
  );
  process.exit(payload.ok && payload.target_met ? 0 : 1);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
