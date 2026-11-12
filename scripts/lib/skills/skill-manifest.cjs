'use strict';

/**
 * ADR-010 SkillManifest helpers (AE-024a): Ajv validate, legacy compat load,
 * and semver/compatibility range checks. Layer: skills (service).
 */

const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv').default;

const SCHEMA_PATH = path.join(__dirname, '..', '..', '..', 'schemas', 'skill-manifest.schema.json');

/** Kinds that imply side-effecting / tool execution rights. */
const EXECUTION_KINDS = new Set(['subagent', 'command', 'plugin', 'tool', 'executable']);

/** Kinds that may declare permissions: [] (read-only / prompt). */
const READ_ONLY_KINDS = new Set(['prompt', 'phase', 'docs']);

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
 * Map Ajv errors to named instance paths (acceptance: named error path per field).
 * @param {import('ajv').ErrorObject[]|null|undefined} errors
 * @returns {string[]}
 */
function formatAjvErrors(errors) {
  return (errors || []).map((e) => {
    if (e.keyword === 'required' && e.params && e.params.missingProperty) {
      const parent = e.instancePath || '';
      return `${parent}/${e.params.missingProperty} is required`;
    }
    const p = e.instancePath || '/';
    return `${p} ${e.message}`;
  });
}

/**
 * Validate a structured SkillManifest against the versioned schema + AE-024a rules.
 * @param {object} manifest
 * @returns {{ ok: true, manifest: object } | { ok: false, code: string, errors: string[] }}
 */
function validateSkillManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, code: 'MANIFEST_INVALID', errors: ['/ must be object'] };
  }
  const validate = getValidator();
  if (!validate(manifest)) {
    return { ok: false, code: 'MANIFEST_INVALID', errors: formatAjvErrors(validate.errors) };
  }

  const kind = manifest.kind || 'unknown';
  const perms = Array.isArray(manifest.permissions) ? manifest.permissions : null;
  if (perms == null) {
    return { ok: false, code: 'PERMISSIONS_REQUIRED', errors: ['/permissions must be explicit'] };
  }
  if (EXECUTION_KINDS.has(kind) && perms.length === 0) {
    return {
      ok: false,
      code: 'PERMISSIONS_EMPTY_FOR_EXECUTION',
      errors: [
        `/permissions empty undeclared execution rights for kind "${kind}" (use non-empty permissions, or kind prompt/phase/docs with permissions: [])`,
      ],
    };
  }
  if (READ_ONLY_KINDS.has(kind) && perms.length === 0) {
    // explicit empty is the allowed form for read-only prompt skills
  }

  return { ok: true, manifest };
}

/**
 * Parse a leading "v"?MAJOR.MINOR.PATCH into parts. Returns null if not plain semver.
 * @param {string} version
 * @returns {{ major: number, minor: number, patch: number }|null}
 */
function parseSemver(version) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(version || '').trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/**
 * Compare two parsed semver tuples: -1 / 0 / 1.
 */
function cmpSemver(a, b) {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

/**
 * Satisfy a simple range: `*`, exact `1.2.3`, `>=1.2.3`, `>1.2.3`, `<=1.2.3`, `<1.2.3`,
 * caret `^1.2.3` (same major), tilde `~1.2.3` (same major.minor).
 * @param {string} version
 * @param {string} range
 * @returns {boolean}
 */
function satisfiesRange(version, range) {
  const v = parseSemver(version);
  if (!v) return false;
  const r = String(range || '').trim();
  if (!r || r === '*' || r === 'x') return true;

  const caret = /^\^(\d+\.\d+\.\d+)$/.exec(r);
  if (caret) {
    const base = parseSemver(caret[1]);
    if (!base) return false;
    if (cmpSemver(v, base) < 0) return false;
    return v.major === base.major;
  }
  const tilde = /^~(\d+\.\d+\.\d+)$/.exec(r);
  if (tilde) {
    const base = parseSemver(tilde[1]);
    if (!base) return false;
    if (cmpSemver(v, base) < 0) return false;
    return v.major === base.major && v.minor === base.minor;
  }
  const op = /^(>=|>|<=|<|=)?\s*(v?\d+\.\d+\.\d+)$/.exec(r);
  if (!op) {
    const exact = parseSemver(r);
    return exact ? cmpSemver(v, exact) === 0 : false;
  }
  const operator = op[1] || '=';
  const base = parseSemver(op[2]);
  if (!base) return false;
  const c = cmpSemver(v, base);
  if (operator === '=') return c === 0;
  if (operator === '>=') return c >= 0;
  if (operator === '>') return c > 0;
  if (operator === '<=') return c <= 0;
  if (operator === '<') return c < 0;
  return false;
}

/**
 * Check whether two manifests are compatible on pack + node runtime ranges.
 * @param {object} a
 * @param {object} b
 * @param {{ packVersion?: string, nodeVersion?: string }} [env]
 * @returns {{ ok: boolean, code?: string, errors: string[] }}
 */
function checkManifestCompatibility(a, b, env = {}) {
  const errors = [];
  const packVersion = env.packVersion || '3.4.0';
  const nodeVersion = env.nodeVersion || process.versions.node;

  for (const [label, m] of [
    ['a', a],
    ['b', b],
  ]) {
    if (!m || !m.compatibility || !m.runtime) {
      errors.push(`/${label} missing compatibility or runtime`);
      continue;
    }
    if (!satisfiesRange(packVersion, m.compatibility.pack)) {
      errors.push(`/${label}/compatibility/pack ${m.compatibility.pack} does not satisfy pack ${packVersion}`);
    }
    if (!satisfiesRange(nodeVersion, m.runtime.node)) {
      errors.push(`/${label}/runtime/node ${m.runtime.node} does not satisfy node ${nodeVersion}`);
    }
  }

  if (errors.length) {
    return { ok: false, code: 'COMPAT_MISMATCH', errors };
  }

  // Pairwise: overlapping pack ranges relative to the same packVersion already checked;
  // also reject when one requires a higher major pack than the other can satisfy.
  const aPack = String(a.compatibility.pack);
  const bPack = String(b.compatibility.pack);
  // If either range cannot be satisfied by a synthetic pivot that satisfies the other, flag.
  // Conservative: when both are caret majors and majors differ → incompatible.
  const aCaret = /^\^(\d+)\./.exec(aPack);
  const bCaret = /^\^(\d+)\./.exec(bPack);
  if (aCaret && bCaret && aCaret[1] !== bCaret[1]) {
    return {
      ok: false,
      code: 'COMPAT_MISMATCH',
      errors: [`/compatibility/pack majors diverge (${aPack} vs ${bPack})`],
    };
  }
  const aNodeCaret = /^\^(\d+)\./.exec(String(a.runtime.node));
  const bNodeCaret = /^\^(\d+)\./.exec(String(b.runtime.node));
  if (aNodeCaret && bNodeCaret && aNodeCaret[1] !== bNodeCaret[1]) {
    return {
      ok: false,
      code: 'COMPAT_MISMATCH',
      errors: [`/runtime/node majors diverge (${a.runtime.node} vs ${b.runtime.node})`],
    };
  }

  return { ok: true, errors: [] };
}

/**
 * Load legacy string metadata into a reduced-trust SkillManifest (origin: unknown).
 * Does not invent eval attestation. Autonomous use still gated elsewhere.
 * @param {{ name: string, description: string, meta?: Record<string,string> }} opts
 * @returns {object}
 */
function legacyToManifest(opts) {
  const meta = opts.meta || {};
  const kind = meta.kind || 'unknown';
  const authors = meta.provenance_authors
    ? String(meta.provenance_authors)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  return {
    name: opts.name,
    version: meta.version || '1.0.0',
    description: opts.description || meta.description || opts.name,
    kind,
    inputs: [],
    outputs: [],
    dependencies: [],
    // Explicit empty for legacy non-execution; execution kinds get a placeholder
    // that validateSkillManifest will reject until migrated (fail-closed for new path).
    permissions: EXECUTION_KINDS.has(kind) ? ['legacy:undeclared'] : [],
    runtime: { node: '>=22.0.0' },
    compatibility: { pack: '^3.0.0' },
    validation: { rules: ['legacy-frontmatter'] },
    provenance: {
      origin: 'unknown',
      license: meta.provenance_license || undefined,
      authors: authors.length ? authors : undefined,
    },
    maintainer: meta.provenance || meta.maintainer || 'unknown',
  };
}

/**
 * Read and validate skills/<name>/manifest.json if present.
 * @param {string} skillDir
 * @returns {null | { ok: true, manifest: object } | { ok: false, code: string, errors: string[] }}
 */
function loadManifestFile(skillDir) {
  const file = path.join(skillDir, 'manifest.json');
  if (!fs.existsSync(file)) return null;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return { ok: false, code: 'MANIFEST_PARSE', errors: [`/ ${err.message}`] };
  }
  return validateSkillManifest(parsed);
}

module.exports = {
  SCHEMA_PATH,
  EXECUTION_KINDS,
  READ_ONLY_KINDS,
  validateSkillManifest,
  checkManifestCompatibility,
  satisfiesRange,
  parseSemver,
  legacyToManifest,
  loadManifestFile,
  formatAjvErrors,
  loadSchema,
};
