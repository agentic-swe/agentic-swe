'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const phasesDir = path.join(__dirname, '..', 'phases');

const EXPECTED_PHASES = [
  'feasibility.md',
  'ambiguity-wait.md',
  'lean-track-check.md',
  'lean-track-implementation.md',
  'design.md',
  'design-review.md',
  'verification.md',
  'test-strategy.md',
  'implementation.md',
  'self-review.md',
  'code-review.md',
  'permissions-check.md',
  'validation.md',
  'pr-creation.md',
  'approval-wait.md',
  'merge-completion.md',
  'initialized.md',
  'escalate-code.md',
  'escalate-validation.md',
  'pipeline-failed.md',
  'subagent-selection.md',
];

describe('phase-structure: every expected phase file exists and has content', () => {
  for (const file of EXPECTED_PHASES) {
    it(`${file} exists and is non-empty`, () => {
      const full = path.join(phasesDir, file);
      assert.ok(fs.existsSync(full), `missing phase file: ${file}`);
      const body = fs.readFileSync(full, 'utf8');
      assert.ok(body.trim().length > 0, `${file} is empty`);
    });

    it(`${file} has an H1 heading`, () => {
      const body = fs.readFileSync(path.join(phasesDir, file), 'utf8');
      assert.match(body, /^# .+/m, `${file} missing H1 heading`);
    });

    it(`${file} has a Mission or Procedure section`, () => {
      const body = fs.readFileSync(path.join(phasesDir, file), 'utf8');
      assert.match(
        body,
        /^## (Mission|Procedure|Signal Collection)/m,
        `${file} missing ## Mission or ## Procedure section`
      );
    });
  }
});
