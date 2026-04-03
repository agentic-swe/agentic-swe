#!/usr/bin/env node
/**
 * Opt-in LLM tests: requires AGENTIC_SWE_LLM_TESTS=1 and `claude` on PATH.
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname);

/** @type {{ name: string, file: string, expectAny: string[], expectAll?: string[] }[]} */
const CASES = [
  {
    name: 'lean-track-prompt',
    file: 'fixtures/lean-track-prompt.txt',
    expectAny: ['feasibility', 'lean-track', 'work', 'pipeline'],
    expectAll: ['feasibility'],
  },
  {
    name: 'rigorous-track-prompt',
    file: 'fixtures/rigorous-track-prompt.txt',
    expectAny: ['feasibility', 'design', 'implementation', 'pipeline', 'work'],
    expectAll: ['design'],
  },
  {
    name: 'ambiguous-task',
    file: 'fixtures/ambiguous-task.txt',
    expectAny: ['ambiguity', 'clarif', 'feasibility', 'work', '/work', 'plan'],
  },
  {
    name: 'resume-work-prompt',
    file: 'fixtures/resume-work-prompt.txt',
    expectAny: ['state', 'work', 'resume', 'feasibility', 'json', 'phase'],
  },
  {
    name: 'standard-scope-prompt',
    file: 'fixtures/standard-scope-prompt.txt',
    expectAny: ['standard', 'design', 'lean-track', 'test', 'implementation', 'track', 'feasibility'],
  },
];

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const errChunks = [];
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => errChunks.push(d));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code,
        out: Buffer.concat(chunks).toString('utf8'),
        err: Buffer.concat(errChunks).toString('utf8'),
      });
    });
  });
}

async function main() {
  if (process.env.AGENTIC_SWE_LLM_TESTS !== '1') {
    console.log('Skip LLM tests (set AGENTIC_SWE_LLM_TESTS=1 to run).');
    process.exit(0);
  }

  const claude = process.env.CLAUDE_CLI || 'claude';
  let failed = 0;

  for (const c of CASES) {
    const promptPath = path.join(root, c.file);
    const prompt = fs.readFileSync(promptPath, 'utf8');
    const args = [
      '-p',
      `You are helping validate the agentic-swe pipeline. The user task is:\n\n${prompt}\n\nReply with a short bullet list naming which pipeline phases or commands you would use first (e.g. feasibility, design, /work).`,
      '--output-format',
      'text',
    ];
    console.log(`--- ${c.name} ---`);
    let result;
    try {
      result = await run(claude, args);
    } catch (e) {
      console.error(`Spawn error for ${c.name}:`, e.message);
      failed++;
      continue;
    }
    const haystack = (result.out + result.err).toLowerCase();
    const anyOk = c.expectAny.some((s) => haystack.includes(s.toLowerCase()));
    const allOk =
      !c.expectAll || c.expectAll.every((s) => haystack.includes(s.toLowerCase()));
    if (!anyOk || !allOk) {
      if (!anyOk) {
        console.error(`FAIL ${c.name}: output did not contain any of: ${c.expectAny.join(', ')}`);
      }
      if (!allOk) {
        console.error(
          `FAIL ${c.name}: expected all of: ${c.expectAll.join(', ')} (substring match)`
        );
      }
      console.error('--- stdout/stderr excerpt ---\n', (result.out + result.err).slice(0, 2000));
      failed++;
    } else {
      console.log(`OK ${c.name}`);
    }
  }

  if (failed) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
