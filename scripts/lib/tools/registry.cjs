'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv').default;

const SCHEMA = path.join(__dirname, '..', '..', '..', 'schemas', 'tool-manifest.schema.json');

function digestManifest(manifest) {
  const ordered = {};
  for (const key of Object.keys(manifest).sort()) ordered[key] = manifest[key];
  return crypto.createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

function validateManifest(manifest) {
  const schema = JSON.parse(fs.readFileSync(SCHEMA, 'utf8'));
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  if (validate(manifest)) return { ok: true, digest: digestManifest(manifest) };
  return {
    ok: false,
    code: 'MANIFEST_INVALID',
    errors: (validate.errors || []).map((e) => `${e.instancePath || '/'} ${e.message}`),
  };
}

function compileInputValidator(manifest) {
  const validate = new Ajv({ allErrors: true, strict: false }).compile(manifest.input_schema);
  return (input) => {
    if (validate(input)) return { ok: true };
    return {
      ok: false,
      code: 'INPUT_INVALID',
      errors: (validate.errors || []).map((e) => `${e.instancePath || '/'} ${e.message}`),
    };
  };
}

class ToolRegistry {
  constructor(entries = [], opts = {}) {
    this.tools = new Map();
    this.pinned_digest = opts.pinned_digest || null;
    for (const entry of entries) this.register(entry.manifest || entry, entry.execute || entry.executor);
    if (this.pinned_digest && this.digest() !== this.pinned_digest) {
      const err = new Error('tool registry digest differs from pinned digest');
      err.code = 'REGISTRY_INVALID';
      throw err;
    }
  }

  register(manifest, execute) {
    const check = validateManifest(manifest);
    if (!check.ok) {
      const err = new Error(`invalid tool manifest ${manifest && manifest.id}: ${check.errors.join('; ')}`);
      err.code = check.code;
      throw err;
    }
    if (typeof execute !== 'function') throw new Error(`tool ${manifest.id} has no executor`);
    if (this.tools.has(manifest.id)) throw new Error(`duplicate tool: ${manifest.id}`);
    this.tools.set(manifest.id, {
      manifest: structuredClone(manifest), execute, manifest_digest: check.digest,
      validateInput: compileInputValidator(manifest),
    });
    return this;
  }

  get(id) { return this.tools.get(id) || null; }
  has(id) { return this.tools.has(id); }
  list() { return [...this.tools.values()].map((entry) => entry.manifest); }
  digest() {
    return crypto.createHash('sha256')
      .update(JSON.stringify([...this.tools.values()].map((entry) => entry.manifest).sort((a, b) => a.id.localeCompare(b.id))))
      .digest('hex');
  }
}

module.exports = { ToolRegistry, validateManifest, compileInputValidator, digestManifest, SCHEMA };
