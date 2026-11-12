'use strict';

/**
 * AE-025a: local file + git-tag skill registry (PD-30).
 * Layer: skills (service). No tools/ require.
 */

const fs = require('node:fs');
const path = require('node:path');
const { validateSkillManifest, satisfiesRange } = require('./skill-manifest.cjs');
const {
  digestSkillBody,
  verifySkillDigest,
  emptyLockfile,
  readLockfile,
  writeLockfileAtomic,
  lockPin,
  resolveLockPin,
  LOCKFILE_NAME,
} = require('./skill-integrity.cjs');

const INDEX_NAME = 'skills-index.json';

function emptyIndex() {
  return { version: 1, skills: {} };
}

function readIndex(indexPath) {
  if (!fs.existsSync(indexPath)) return emptyIndex();
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !parsed.skills) return emptyIndex();
    return parsed;
  } catch {
    const err = new Error('skills index parse failed');
    err.code = 'INDEX_INVALID';
    throw err;
  }
}

function writeIndexAtomic(indexPath, index) {
  const dir = path.dirname(indexPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${indexPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, indexPath);
}

/**
 * @param {string} name
 * @param {string} range
 * @param {object} index
 * @returns {{ ok: true, manifest: object, version: string } | { ok: false, code: string }}
 */
function resolve(name, range, index) {
  const n = String(name || '').trim();
  if (!n) return { ok: false, code: 'NOT_FOUND' };
  const entry = index.skills[n];
  if (!entry || !Array.isArray(entry.versions) || !entry.versions.length) {
    return { ok: false, code: 'NOT_FOUND' };
  }
  const matching = entry.versions
    .filter((v) => v && v.manifest && satisfiesRange(v.manifest.version, range || '*'))
    .sort((a, b) => String(b.manifest.version).localeCompare(String(a.manifest.version), undefined, { numeric: true }));
  if (!matching.length) return { ok: false, code: 'NO_SATISFYING_VERSION' };
  return { ok: true, manifest: structuredClone(matching[0].manifest), version: matching[0].manifest.version };
}

function detectDepCycle(name, index, stack = []) {
  if (stack.includes(name)) return [...stack, name];
  const entry = index.skills[name];
  if (!entry || !entry.versions || !entry.versions.length) return null;
  const manifest = entry.versions[0].manifest;
  const deps = (manifest && manifest.dependencies) || [];
  for (const d of deps) {
    const hit = detectDepCycle(d.name, index, [...stack, name]);
    if (hit) return hit;
  }
  return null;
}

/**
 * Validate dependencies against index. Missing or cyclic → DEP_INVALID.
 */
function validateDependencies(manifest, index) {
  const deps = Array.isArray(manifest.dependencies) ? manifest.dependencies : [];
  for (const d of deps) {
    const r = resolve(d.name, d.range || '*', index);
    if (!r.ok) {
      return { ok: false, code: 'DEP_INVALID', errors: [`dependency ${d.name}@${d.range || '*'} ${r.code}`] };
    }
  }
  const cycle = detectDepCycle(manifest.name, index);
  // Also check if adding this manifest would create a cycle via its deps pointing back
  const probe = structuredClone(index);
  if (!probe.skills[manifest.name]) {
    probe.skills[manifest.name] = { versions: [{ manifest }] };
  }
  for (const d of deps) {
    const hit = detectDepCycle(d.name, probe, [manifest.name]);
    if (hit) {
      return { ok: false, code: 'DEP_INVALID', errors: [`dependency cycle: ${hit.join(' -> ')}`] };
    }
  }
  if (cycle) {
    return { ok: false, code: 'DEP_INVALID', errors: [`dependency cycle: ${cycle.join(' -> ')}`] };
  }
  return { ok: true };
}

/**
 * Install a skill package from a local directory into registry root.
 * @param {{
 *   registryRoot: string,
 *   sourceDir: string,
 *   transport?: { fetch?: Function } | null,
 *   crashBeforeActivate?: boolean,
 * }} opts
 */
function installSkill(opts) {
  const registryRoot = path.resolve(opts.registryRoot);
  const sourceDir = path.resolve(opts.sourceDir);
  const transport = opts.transport || null;

  // Network default deny: any fetch without injected transport fails closed.
  if (opts.requireNetwork) {
    if (!transport || typeof transport.fetch !== 'function') {
      return { ok: false, code: 'NETWORK_DENIED' };
    }
  }

  const manifestPath = path.join(sourceDir, 'manifest.json');
  const skillMdPath = path.join(sourceDir, 'SKILL.md');
  if (!fs.existsSync(manifestPath) || !fs.existsSync(skillMdPath)) {
    return { ok: false, code: 'SOURCE_INVALID', errors: ['manifest.json and SKILL.md required'] };
  }

  // Refuse lifecycle scripts / postinstall equivalents.
  for (const banned of ['postinstall.js', 'install.js', 'preinstall.js', 'package.json']) {
    if (fs.existsSync(path.join(sourceDir, banned))) {
      // package.json only banned if it declares scripts
      if (banned === 'package.json') {
        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(sourceDir, banned), 'utf8'));
          if (pkg.scripts && Object.keys(pkg.scripts).length) {
            return { ok: false, code: 'INSTALL_SCRIPTS_FORBIDDEN' };
          }
        } catch {
          return { ok: false, code: 'INSTALL_SCRIPTS_FORBIDDEN' };
        }
      } else {
        return { ok: false, code: 'INSTALL_SCRIPTS_FORBIDDEN' };
      }
    }
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    return { ok: false, code: 'MANIFEST_PARSE', errors: [err.message] };
  }
  const validated = validateSkillManifest(manifest);
  if (!validated.ok) return { ok: false, code: validated.code, errors: validated.errors };

  const raw = fs.readFileSync(skillMdPath, 'utf8');
  const digest = digestSkillBody(raw);
  if (manifest.digest) {
    const v = verifySkillDigest(raw, manifest.digest);
    if (!v.ok) return { ok: false, code: v.code, digest: v.digest, expected: v.expected };
  } else {
    manifest = { ...manifest, digest };
  }

  const indexPath = path.join(registryRoot, INDEX_NAME);
  const lockPath = path.join(registryRoot, LOCKFILE_NAME);
  const index = readIndex(indexPath);
  const deps = validateDependencies(manifest, index);
  if (!deps.ok) return deps;

  // Fail closed on corrupt lock before any activation (do not swallow parse errors).
  let lock;
  try {
    lock = readLockfile(lockPath);
  } catch (err) {
    return { ok: false, code: 'LOCKFILE_INVALID', errors: [err.message] };
  }

  const destDir = path.join(registryRoot, 'skills', manifest.name, manifest.version);
  const staging = `${destDir}.staging.${process.pid}.${Date.now()}`;

  fs.mkdirSync(staging, { recursive: true });
  try {
    fs.copyFileSync(skillMdPath, path.join(staging, 'SKILL.md'));
    fs.writeFileSync(path.join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    if (opts.crashBeforeActivate) {
      // Simulate crash mid-install: staging left behind, dest/index/lock untouched.
      return { ok: false, code: 'INSTALL_CRASHED', staging };
    }

    fs.mkdirSync(path.dirname(destDir), { recursive: true });
    if (fs.existsSync(destDir)) {
      // Same version already installed — refuse digest drift (incl. blank vs set).
      const existing = JSON.parse(fs.readFileSync(path.join(destDir, 'manifest.json'), 'utf8'));
      const prev = String(existing.digest || '').trim().toLowerCase();
      const next = String(manifest.digest || '').trim().toLowerCase();
      if (prev !== next) {
        fs.rmSync(staging, { recursive: true, force: true });
        return { ok: false, code: 'VERSION_IMMUTABLE' };
      }
      fs.rmSync(staging, { recursive: true, force: true });
    } else {
      fs.renameSync(staging, destDir);
    }

    if (!index.skills[manifest.name]) index.skills[manifest.name] = { versions: [] };
    const versions = index.skills[manifest.name].versions.filter((v) => v.manifest.version !== manifest.version);
    versions.push({ manifest, path: path.relative(registryRoot, destDir) });
    index.skills[manifest.name].versions = versions;
    writeIndexAtomic(indexPath, index);

    lockPin(lock, manifest.name, { version: manifest.version, digest: manifest.digest });
    writeLockfileAtomic(lockPath, lock);

    return { ok: true, path: destDir, manifest, digest: manifest.digest };
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true });
    return { ok: false, code: 'INSTALL_FAILED', errors: [err.message] };
  }
}

/**
 * Resolve from registry and verify lock pin.
 */
function resolveAndVerify(registryRoot, name, range) {
  const index = readIndex(path.join(registryRoot, INDEX_NAME));
  const r = resolve(name, range, index);
  if (!r.ok) return r;
  const lockPath = path.join(registryRoot, LOCKFILE_NAME);
  if (!fs.existsSync(lockPath)) return { ok: false, code: 'LOCK_NOT_FOUND' };
  const lock = readLockfile(lockPath);
  const skillDir = path.join(registryRoot, 'skills', name, r.version);
  const raw = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  const pin = resolveLockPin(lock, name, raw);
  if (!pin.ok) return pin;
  return { ok: true, manifest: r.manifest, version: r.version, digest: pin.digest };
}

module.exports = {
  INDEX_NAME,
  emptyIndex,
  readIndex,
  writeIndexAtomic,
  resolve,
  validateDependencies,
  installSkill,
  resolveAndVerify,
};
