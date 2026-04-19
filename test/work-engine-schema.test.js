'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { validateWorkItemSchemaAtRoot } = require('../scripts/lib/work-engine/validate-schema.cjs');

const pluginRoot = path.join(__dirname, '..');
const templatePath = path.join(pluginRoot, 'templates', 'state.json');

describe('work-item JSON Schema', () => {
  it('validates templates/state.json', () => {
    const state = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
    const r = validateWorkItemSchemaAtRoot(state, pluginRoot);
    assert.strictEqual(r.ok, true, r.errors && JSON.stringify(r.errors, null, 2));
  });

  it('rejects missing budget keys', () => {
    const state = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
    delete state.budget.budget_remaining;
    const r = validateWorkItemSchemaAtRoot(state, pluginRoot);
    assert.strictEqual(r.ok, false);
  });

  it('rejects history object without from/to or timestamp', () => {
    const state = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
    state.history = [{ actor: 'x' }];
    const r = validateWorkItemSchemaAtRoot(state, pluginRoot);
    assert.strictEqual(r.ok, false);
  });
});
