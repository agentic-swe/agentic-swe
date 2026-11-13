'use strict';

/**
 * ADR-013 frozen eval manifest helpers (AE-034a): Ajv validate, digest, load.
 * Layer: bench (service). No holdout packaging or runners here (AE-034b/c).
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv').default;

const SCHEMA_PATH = path.join(__dirname, '..', '..', '..', 'schemas', 'eval-manifest.schema.json');

const LOCAL_PROVIDERS = new Set(['ollama', 'llama.cpp']);

/** Fields included in the digest payload (manifest_digest itself is excluded). */
const DIGEST_KEYS = Object.freeze([
  'schema_version',
  'id',
  'description',
  'pool',
  'cold_run_required',
  'retain_negatives',
  'pack_commit',
  'tasks',
  'model_provenance',
]);

let cachedValidator = null;

function loadSchema() {
  return JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
}

function getValidator() {
  if (!cachedValidator) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    cachedValidator = ajv.compile(loadSchema());
  }
  return cachedValidator;
}

/**
 * Map Ajv errors to named instance paths (acceptance: named path per failure).
 * @param {import('ajv').ErrorObject[]|null|undefined} errors
 * @returns {string[]}
 */
function formatAjvErrors(errors) {
  return (errors || []).map((e) => {
    if (e.keyword === 'required' && e.params && e.params.missingProperty) {
      const parent = e.instancePath || '';
      return `${parent}/${e.params.missingProperty} is required`;
    }
    if (e.keyword === 'additionalProperties' && e.params && e.params.additionalProperty) {
      const parent = e.instancePath || '';
      return `${parent}/${e.params.additionalProperty} is not allowed`;
    }
    if (e.schema === false || e.keyword === 'false schema') {
      const p = e.instancePath || '/';
      return `${p} is forbidden`;
    }
    const p = e.instancePath || '/';
    return `${p} ${e.message}`;
  });
}

/**
 * Stable JSON for digesting: sorted object keys, arrays in order.
 * @param {unknown} value
 * @returns {unknown}
 */
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = canonicalize(value[key]);
  }
  return out;
}

/**
 * Compute the frozen digest for a manifest body (excludes manifest_digest).
 * @param {object} manifest
 * @returns {string} sha256 hex
 */
function computeManifestDigest(manifest) {
  const payload = {};
  for (const key of DIGEST_KEYS) {
    if (manifest[key] !== undefined) payload[key] = manifest[key];
  }
  const text = JSON.stringify(canonicalize(payload));
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Semantic checks beyond JSON Schema (PD-41 local ≠ sole E8; digest pin).
 * @param {object} manifest
 * @returns {string[]} named-path errors
 */
function semanticErrors(manifest) {
  const errors = [];
  const prov = manifest.model_provenance;
  if (prov && typeof prov === 'object') {
    if (LOCAL_PROVIDERS.has(prov.provider)) {
      if (prov.sole_e8_proof !== false) {
        errors.push('/model_provenance/sole_e8_proof must be false for local ollama/llama.cpp (PD-41)');
      }
      if (prov.label !== 'observed') {
        errors.push('/model_provenance/label must be "observed" for local ollama/llama.cpp (PD-41)');
      }
    }
  }

  if (typeof manifest.manifest_digest === 'string' && /^[a-f0-9]{64}$/.test(manifest.manifest_digest)) {
    const expected = computeManifestDigest(manifest);
    if (manifest.manifest_digest !== expected) {
      errors.push(`/manifest_digest does not match frozen payload (expected ${expected})`);
    }
  }

  const tasks = Array.isArray(manifest.tasks) ? manifest.tasks : [];
  tasks.forEach((task, i) => {
    if (!task || typeof task !== 'object') return;
    // Floating / mutable pins are forbidden even if sneaked past additionalProperties.
    for (const bad of ['ref', 'branch', 'tag', 'mutable', 'latest', 'unpinned']) {
      if (Object.prototype.hasOwnProperty.call(task, bad)) {
        errors.push(`/tasks/${i}/${bad} is not allowed (tasks must be content-SHA pinned)`);
      }
    }
    const sha = task.content_sha256;
    if (sha === '' || sha === null) {
      errors.push(`/tasks/${i}/content_sha256 is required`);
    }
  });

  return errors;
}

/**
 * Validate a frozen eval manifest against ADR-013 schema + AE-034a rules.
 * @param {object} manifest
 * @returns {{ ok: true, manifest: object, digest: string } | { ok: false, code: string, errors: string[] }}
 */
function validateEvalManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, code: 'MANIFEST_INVALID', errors: ['/ must be object'] };
  }

  const validate = getValidator();
  if (!validate(manifest)) {
    return { ok: false, code: 'MANIFEST_INVALID', errors: formatAjvErrors(validate.errors) };
  }

  const sem = semanticErrors(manifest);
  if (sem.length > 0) {
    return { ok: false, code: 'MANIFEST_INVALID', errors: sem };
  }

  return { ok: true, manifest, digest: manifest.manifest_digest };
}

/**
 * Load and validate a manifest JSON file.
 * @param {string} filePath
 * @returns {{ ok: true, manifest: object, digest: string, path: string } | { ok: false, code: string, errors: string[], path: string }}
 */
function validateEvalManifestFile(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    return { ok: false, code: 'MANIFEST_MISSING', errors: [`${abs}: file not found`], path: abs };
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (e) {
    return {
      ok: false,
      code: 'MANIFEST_INVALID',
      errors: [`${abs}: not valid JSON: ${e.message}`],
      path: abs,
    };
  }
  const check = validateEvalManifest(parsed);
  if (!check.ok) return { ...check, path: abs };
  return { ok: true, manifest: check.manifest, digest: check.digest, path: abs };
}

/**
 * Discover `*.json` eval manifests under a directory (non-recursive).
 * @param {string} dir
 * @returns {string[]}
 */
function discoverEvalManifests(dir) {
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return [];
  return fs
    .readdirSync(abs)
    .filter((name) => name.endsWith('.json') && !name.startsWith('.'))
    .map((name) => path.join(abs, name))
    .sort();
}

module.exports = {
  SCHEMA_PATH,
  loadSchema,
  computeManifestDigest,
  validateEvalManifest,
  validateEvalManifestFile,
  discoverEvalManifests,
  formatAjvErrors,
};
