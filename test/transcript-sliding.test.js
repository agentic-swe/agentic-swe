'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { parseTranscriptTurns, buildSlidingSummaryMarkdown } = require('../scripts/lib/memory/transcript-sliding.cjs');

const fixture = path.join(__dirname, 'fixtures', 'transcript-cost-sample.jsonl');

describe('transcript sliding summary', () => {
  it('parses user/assistant turns from JSONL', () => {
    const turns = parseTranscriptTurns(fixture);
    assert.ok(turns.length >= 2);
    assert.strictEqual(turns[0].role, 'user');
    assert.ok(turns[0].text.includes('hi'));
  });

  it('builds markdown without LLM', async () => {
    const turns = parseTranscriptTurns(fixture);
    const md = await buildSlidingSummaryMarkdown(turns, {
      recentVerbatim: 2,
      maxOldChars: 100,
      useLlm: false,
    });
    assert.ok(md.includes('Recent turns'));
    assert.ok(md.includes('hello'));
  });
});
