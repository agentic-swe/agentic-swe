'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { textFromJsonlLine } = require('../scripts/lib/memory/session-ingest.cjs');
const { translate } = require('../scripts/lib/runtime/cursor.cjs');
const {
  mineTranscriptProcedures,
  extractActionsFromTranscriptFile,
  isVerifyCommand,
} = require('../scripts/lib/descent/mine-transcript-procedures.cjs');

describe('transcript tool traces', () => {
  it('serializes Read and Shell tool_use into memory text', () => {
    const line = {
      role: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Checking the capture path.' },
          { type: 'tool_use', name: 'Read', input: { path: 'scripts/lib/descent/capture-procedure.cjs' } },
          { type: 'tool_use', name: 'Shell', input: { command: 'npm test', description: 'run tests' } },
        ],
      },
    };
    const text = textFromJsonlLine(line);
    assert.match(text, /Checking the capture path/);
    assert.match(text, /\[tool Read scripts\/lib\/descent\/capture-procedure\.cjs\]/);
    assert.match(text, /\[tool Shell npm test\]/);
  });

  it('does not treat writes as verify commands', () => {
    assert.equal(isVerifyCommand('npm test'), true);
    assert.equal(isVerifyCommand('rm -rf /'), false);
    assert.equal(isVerifyCommand('npm install && npm test'), false);
    assert.equal(isVerifyCommand('node --test test/ok.test.js'), true);
  });

  it('maps typed actions to Cursor tool names', () => {
    const t = translate({ type: 'RUN', command: 'node --test test/ok.test.js' });
    assert.equal(t.tool, 'Shell');
    assert.equal(t.params.command, 'node --test test/ok.test.js');
  });

  it('mines READ_FILE + npm test from a Cursor-shaped jsonl into unevaluated procedures', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-mine-'));
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'app.js'), 'module.exports = 1;\n');
    const extra = path.join(tmp, 'chats');
    fs.mkdirSync(extra, { recursive: true });
    const tx = path.join(extra, 'session.jsonl');
    const absRead = path.join(tmp, 'src', 'app.js');
    fs.writeFileSync(
      tx,
      [
        JSON.stringify({
          role: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Read', input: { path: absRead } },
              { type: 'tool_use', name: 'Write', input: { path: absRead, contents: 'nope' } },
              { type: 'tool_use', name: 'Shell', input: { command: 'npm test' } },
            ],
          },
        }),
      ].join('\n') + '\n'
    );

    const actions = extractActionsFromTranscriptFile(tx, tmp);
    assert.equal(actions.some((a) => a.type === 'READ_FILE' && a.path === 'src/app.js'), true);
    assert.equal(actions.some((a) => a.type === 'RUN' && a.command === 'npm test'), true);
    assert.equal(actions.some((a) => a.type === 'WRITE_FILE'), false);

    const r = mineTranscriptProcedures({ projectRoot: tmp, extraDirs: [extra], limit: 8 });
    assert.equal(r.ok, true);
    assert.ok(r.procedures >= 1);
    const store = JSON.parse(fs.readFileSync(path.join(tmp, '.agentic-swe', 'procedures.json'), 'utf8'));
    const rec = store.procedures.find((p) => p.procedure?._meta?.source === 'transcript-tools');
    assert.ok(rec);
    assert.equal(rec.eval_status, 'unevaluated');
    assert.equal(rec.procedure.verify[0].command, 'npm test');
    assert.equal(rec.procedure.actions[0].path, 'src/app.js');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('evaluates isolated node --test from a transcript so the ladder can replay', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-eval-'));
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
    const extra = path.join(tmp, 'chats');
    fs.mkdirSync(extra, { recursive: true });
    const verify = `node --test ${testRel}`;
    fs.writeFileSync(
      path.join(extra, 'session.jsonl'),
      JSON.stringify({
        role: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Read', input: { path: path.join(tmp, testRel) } },
            { type: 'tool_use', name: 'Shell', input: { command: verify } },
          ],
        },
      }) + '\n'
    );
    const r = mineTranscriptProcedures({ projectRoot: tmp, extraDirs: [extra], limit: 8 });
    assert.equal(r.ok, true);
    const store = JSON.parse(fs.readFileSync(path.join(tmp, '.agentic-swe', 'procedures.json'), 'utf8'));
    const rec = store.procedures.find((p) => p.procedure?._meta?.source === 'transcript-tools');
    assert.ok(rec);
    assert.equal(rec.eval_status, 'evaluated');
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
