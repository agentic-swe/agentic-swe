'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ingestTranscripts } = require('../scripts/lib/memory/session-ingest.cjs');
const { mineSessionProcedures } = require('../scripts/lib/descent/mine-session-procedures.cjs');
const { runDescentOnImplementationEntry } = require('../scripts/lib/descent/implementation-descent.cjs');

const pluginRoot = path.resolve(__dirname, '..');

describe('session-mine implementation descent', () => {
  it('mines isolated verify from session chunks and skip_llm on overlapping design', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sess-md-'));
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'test'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'hit.js'), 'module.exports = 1;\n');
    fs.writeFileSync(
      path.join(tmp, 'test', 'hit.test.js'),
      `'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
test('hit', () => assert.equal(require('../src/hit.js'), 1));
`
    );
    const transcript = path.join(tmp, 'session.jsonl');
    fs.writeFileSync(
      transcript,
      `${JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: 'Edited `src/hit.js` and ran node --test test/hit.test.js' },
      })}\n`
    );
    await ingestTranscripts({
      projectRoot: tmp,
      pluginRoot,
      transcriptPaths: [transcript],
      maxFiles: 4,
    });
    const mined = await mineSessionProcedures({
      projectRoot: tmp,
      pluginRoot,
      storeRoot: tmp,
      limit: 8,
    });
    assert.ok(mined.procedures >= 1, JSON.stringify(mined));

    const workDir = path.join(tmp, '.worklogs', 'w-follow');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(
      path.join(workDir, 'state.json'),
      JSON.stringify({
        work_id: 'w-follow',
        current_state: 'test-strategy',
        metrics: { verify_command: 'npm test' },
        budget: {},
      })
    );
    fs.writeFileSync(path.join(workDir, 'design.md'), '# Design\n\n- `src/hit.js`\n\n```bash\nnpm test\n```\n');
    const r = await runDescentOnImplementationEntry({ workDir, pluginRoot, projectRoot: tmp });
    assert.equal(r.skip_llm_exploration, true, JSON.stringify({ tier: r.tier, overlap: r.overlap_source }));
    assert.equal(r.overlap_source, 'session-mine');
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
