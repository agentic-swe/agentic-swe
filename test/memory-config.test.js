'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
// eslint-disable-next-line import/no-extraneous-dependencies
const Ajv = require('ajv/dist/2020').default;

const { loadMergedMemoryConfig, sqlitePathForProject } = require('../scripts/lib/memory/config.cjs');

const root = path.join(__dirname, '..');

describe('memory config', () => {
  it('default JSON validates against schema', () => {
    const schema = JSON.parse(fs.readFileSync(path.join(root, 'schemas', 'memory-config.schema.json'), 'utf8'));
    const data = JSON.parse(fs.readFileSync(path.join(root, 'config', 'memory.default.json'), 'utf8'));
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    const ok = validate(data);
    assert.ok(ok, validate.errors ? JSON.stringify(validate.errors, null, 2) : '');
  });

  it('loadMergedMemoryConfig returns defaults from pack', () => {
    const merged = loadMergedMemoryConfig(root, null);
    assert.strictEqual(merged.schema_version, 1);
    assert.strictEqual(merged.store.directory_relative, '.agentic-swe');
    assert.ok(Array.isArray(merged.ingest.include_globs));
  });

  it('sqlitePathForProject joins directory and file', () => {
    const merged = loadMergedMemoryConfig(root, null);
    const p = sqlitePathForProject(merged, root);
    assert.ok(p.endsWith(path.join('.agentic-swe', 'memory.sqlite')));
  });
});
