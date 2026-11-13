'use strict';

/**
 * AE-025a/b: local file + git-tag skill registry (PD-30).
 * Layer: skills (service). No tools/ require.
 *
 * Git tag / ref conventions (immutable version pointers):
 *   skill/<name>/v<semver>   e.g. skill/alpha/v1.2.0
 * Digest in the lockfile is authoritative if a tag moves.
 * Revocation list is local: skills-revocation.json under the registry root.
 * Update = publish a new semver; never mutate a published digest.
 * Revoke blocks NEW installs; already-installed files are left in place.
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
const { scanInstallPackage } = require('./install-scan.cjs');
const { requirePublishReview } = require('./skill-publish-review.cjs');
const { assertPublishCompareGate } = require('./skill-version-compare.cjs');

const INDEX_NAME = 'skills-index.json';
const REVOCATION_NAME = 'skills-revocation.json';
const REGISTRY_LOG_NAME = 'skills-registry.jsonl';

const STATUS_ACTIVE = 'active';
const STATUS_DEPRECATED = 'deprecated';
const STATUS_REVOKED = 'revoked';

/**
 * Canonical git tag ref for a published skill version (PD-30 / ADR-010).
 * @param {string} name
 * @param {string} version
 * @returns {string}
 */
function gitTagRef(name, version) {
  const n = String(name || '').trim();
  const v = String(version || '').trim().replace(/^v/i, '');
  if (!n || !v) {
    const err = new Error('git tag ref requires name and version');
    err.code = 'TAG_REF_INVALID';
    throw err;
  }
  return `skill/${n}/v${v}`;
}

function emptyIndex() {
  return { version: 1, skills: {} };
}

function emptyRevocation() {
  return { version: 1, entries: [] };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readIndex(indexPath) {
  if (!fs.existsSync(indexPath)) return emptyIndex();
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  } catch {
    const err = new Error('skills index parse failed');
    err.code = 'INDEX_INVALID';
    throw err;
  }
  // Fail closed: parseable but missing/non-object `skills` must not look like an empty registry.
  if (!isPlainObject(parsed) || !isPlainObject(parsed.skills)) {
    const err = new Error('skills index schema invalid');
    err.code = 'INDEX_INVALID';
    throw err;
  }
  return parsed;
}

function writeIndexAtomic(indexPath, index) {
  const dir = path.dirname(indexPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${indexPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, indexPath);
}

function readRevocation(revocationPath) {
  if (!fs.existsSync(revocationPath)) return emptyRevocation();
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(revocationPath, 'utf8'));
  } catch {
    const err = new Error('skills revocation list parse failed');
    err.code = 'REVOCATION_INVALID';
    throw err;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.entries)) {
    const err = new Error('skills revocation list schema invalid');
    err.code = 'REVOCATION_INVALID';
    throw err;
  }
  return parsed;
}

function writeRevocationAtomic(revocationPath, list) {
  const dir = path.dirname(revocationPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${revocationPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, revocationPath);
}

function normalizeActor(actor) {
  const a = String(actor || '').trim();
  if (!a) {
    const err = new Error('actor required for registry lifecycle');
    err.code = 'ACTOR_REQUIRED';
    throw err;
  }
  return a;
}

/**
 * Append-only registry audit log (JSONL). No invented events — caller supplies action.
 * Fail closed on blank actor/action or write error (surfaces to caller).
 */
function appendRegistryLog(registryRoot, event) {
  const actor = String(event && event.actor || '').trim();
  const action = String(event && event.action || '').trim();
  if (!actor) {
    const err = new Error('registry log requires actor');
    err.code = 'ACTOR_REQUIRED';
    throw err;
  }
  if (!action) {
    const err = new Error('registry log requires action');
    err.code = 'LOG_ACTION_REQUIRED';
    throw err;
  }
  const line = JSON.stringify({
    ts: event.ts || new Date().toISOString(),
    action,
    actor,
    name: event.name != null ? String(event.name) : undefined,
    version: event.version != null ? String(event.version) : undefined,
    digest: event.digest != null ? String(event.digest) : undefined,
    reason: event.reason != null ? String(event.reason) : undefined,
    tag: event.tag != null ? String(event.tag) : undefined,
    code: event.code != null ? String(event.code) : undefined,
    approval_ref: event.approval_ref != null ? String(event.approval_ref) : undefined,
    reviewer: event.reviewer != null ? String(event.reviewer) : undefined,
    review_verdict: event.review_verdict != null ? String(event.review_verdict) : undefined,
    compare_digest: event.compare_digest != null ? String(event.compare_digest) : undefined,
  });
  const logPath = path.join(path.resolve(registryRoot), REGISTRY_LOG_NAME);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${line}\n`, 'utf8');
  return logPath;
}

function readRegistryLog(registryRoot) {
  const logPath = path.join(path.resolve(registryRoot), REGISTRY_LOG_NAME);
  if (!fs.existsSync(logPath)) return [];
  const text = fs.readFileSync(logPath, 'utf8');
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      const err = new Error('skills registry log parse failed');
      err.code = 'REGISTRY_LOG_INVALID';
      throw err;
    }
  }
  return out;
}

function versionStatus(v) {
  const s = String((v && v.status) || STATUS_ACTIVE).trim().toLowerCase();
  if (s === STATUS_DEPRECATED || s === STATUS_REVOKED) return s;
  return STATUS_ACTIVE;
}

function findVersionEntry(index, name, version) {
  const entry = index.skills[name];
  if (!entry || !Array.isArray(entry.versions)) return null;
  return entry.versions.find((v) => v && v.manifest && String(v.manifest.version) === String(version)) || null;
}

function isRevokedInList(list, name, version) {
  const n = String(name || '').trim();
  const ver = String(version || '').trim();
  if (!n || !ver) return false;
  return (list.entries || []).some(
    (e) => e && String(e.name || '').trim() === n && String(e.version || '').trim() === ver
  );
}

/**
 * @param {string} name
 * @param {string} range
 * @param {object} index
 * @param {{ allowRevoked?: boolean, revocation?: object }} [opts]
 * @returns {{ ok: true, manifest: object, version: string, status: string, warning?: object } | { ok: false, code: string }}
 */
function resolve(name, range, index, opts = {}) {
  const n = String(name || '').trim();
  if (!n) return { ok: false, code: 'NOT_FOUND' };
  const entry = index.skills[n];
  if (!entry || !Array.isArray(entry.versions) || !entry.versions.length) {
    return { ok: false, code: 'NOT_FOUND' };
  }
  const allowRevoked = opts.allowRevoked === true;
  const revocation = opts.revocation || null;

  const matching = entry.versions
    .filter((v) => v && v.manifest && satisfiesRange(v.manifest.version, range || '*'))
    .filter((v) => {
      const status = versionStatus(v);
      if (status === STATUS_REVOKED && !allowRevoked) return false;
      if (
        revocation &&
        isRevokedInList(revocation, n, v.manifest.version) &&
        !allowRevoked
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) =>
      String(b.manifest.version).localeCompare(String(a.manifest.version), undefined, { numeric: true })
    );

  if (!matching.length) {
    // Distinguish: versions exist but all revoked / none satisfy range.
    const anySatisfy = entry.versions.some(
      (v) => v && v.manifest && satisfiesRange(v.manifest.version, range || '*')
    );
    if (anySatisfy) return { ok: false, code: 'NO_SATISFYING_VERSION' };
    return { ok: false, code: 'NO_SATISFYING_VERSION' };
  }

  const chosen = matching[0];
  const status = versionStatus(chosen);
  const result = {
    ok: true,
    manifest: structuredClone(chosen.manifest),
    version: chosen.manifest.version,
    status,
  };
  if (status === STATUS_DEPRECATED) {
    result.warning = {
      code: 'DEPRECATED',
      name: n,
      version: chosen.manifest.version,
      reason: chosen.deprecated_reason || undefined,
    };
  }
  return result;
}

function detectDepCycle(name, index, stack = []) {
  if (stack.includes(name)) return [...stack, name];
  const entry = index.skills[name];
  if (!entry || !entry.versions || !entry.versions.length) return null;
  // Use highest non-revoked for cycle probe when possible
  const active = entry.versions.find((v) => versionStatus(v) !== STATUS_REVOKED) || entry.versions[0];
  const manifest = active && active.manifest;
  const deps = (manifest && manifest.dependencies) || [];
  for (const d of deps) {
    const hit = detectDepCycle(d.name, index, [...stack, name]);
    if (hit) return hit;
  }
  return null;
}

/**
 * Validate dependencies against index. Missing, revoked-only, or cyclic → DEP_INVALID.
 */
function validateDependencies(manifest, index, opts = {}) {
  const deps = Array.isArray(manifest.dependencies) ? manifest.dependencies : [];
  for (const d of deps) {
    const r = resolve(d.name, d.range || '*', index, opts);
    if (!r.ok) {
      return { ok: false, code: 'DEP_INVALID', errors: [`dependency ${d.name}@${d.range || '*'} ${r.code}`] };
    }
  }
  const cycle = detectDepCycle(manifest.name, index);
  const probe = structuredClone(index);
  if (!probe.skills[manifest.name]) {
    probe.skills[manifest.name] = { versions: [{ manifest, status: STATUS_ACTIVE }] };
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
 *   actor?: string,
 *   requireNetwork?: boolean,
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

  // AE-027b: artifact/deps scan before activation (additive fail-closed).
  if (opts.skipScan !== true) {
    const scan = typeof opts.scan === 'function' ? opts.scan(sourceDir) : scanInstallPackage(sourceDir);
    if (!scan || scan.ok !== true) {
      return {
        ok: false,
        code: (scan && scan.code) || 'SCAN_FAILED',
        findings: (scan && scan.findings) || [],
        message: (scan && scan.message) || 'install scan failed',
      };
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
  const revocationPath = path.join(registryRoot, REVOCATION_NAME);

  let index;
  let revocation;
  try {
    index = readIndex(indexPath);
    revocation = readRevocation(revocationPath);
  } catch (err) {
    return { ok: false, code: err.code || 'REGISTRY_INVALID', errors: [err.message] };
  }

  // Revoked versions cannot be newly installed (list or index status).
  const existingEntry = findVersionEntry(index, manifest.name, manifest.version);
  if (
    isRevokedInList(revocation, manifest.name, manifest.version) ||
    (existingEntry && versionStatus(existingEntry) === STATUS_REVOKED)
  ) {
    return { ok: false, code: 'REVOKED', name: manifest.name, version: manifest.version };
  }

  const deps = validateDependencies(manifest, index, { revocation });
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
    const versions = index.skills[manifest.name].versions.filter(
      (v) => v.manifest.version !== manifest.version
    );
    const priorStatus = existingEntry ? versionStatus(existingEntry) : STATUS_ACTIVE;
    versions.push({
      manifest,
      path: path.relative(registryRoot, destDir),
      status: priorStatus === STATUS_REVOKED ? STATUS_REVOKED : priorStatus,
      tag: gitTagRef(manifest.name, manifest.version),
    });
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

function readFileOrNull(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath);
}

function restoreFileBytesAtomic(filePath, priorBytes) {
  if (priorBytes === null) {
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
    return;
  }
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, priorBytes);
  fs.renameSync(tmp, filePath);
}

/**
 * Surface the audit failure; if compensation also fails, name both errors.
 * Never swallow the original append error.
 */
function registryLogFailure(err, compensate) {
  const code = err.code || 'REGISTRY_LOG_FAILED';
  try {
    compensate();
    return { ok: false, code, errors: [err.message] };
  } catch (compErr) {
    return {
      ok: false,
      code: 'REGISTRY_LOG_FAILED',
      errors: [
        `audit log failed: ${err.message}`,
        `compensation failed: ${compErr.message}`,
      ],
    };
  }
}

function peekPackageIdentity(sourceDir) {
  const manifestPath = path.join(path.resolve(sourceDir), 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const name = String((parsed && parsed.name) || '').trim();
    const version = String((parsed && parsed.version) || '').trim();
    if (!name || !version) return null;
    return { name, version };
  } catch {
    return null;
  }
}

function snapshotPublishState(registryRoot, name, version) {
  const root = path.resolve(registryRoot);
  const indexPath = path.join(root, INDEX_NAME);
  const lockPath = path.join(root, LOCKFILE_NAME);
  const destDir = path.join(root, 'skills', name, version);
  return {
    indexPath,
    lockPath,
    destDir,
    priorIndex: readFileOrNull(indexPath),
    priorLock: readFileOrNull(lockPath),
    destExisted: fs.existsSync(destDir),
  };
}

function compensatePublishInstall(snap) {
  if (!snap.destExisted && fs.existsSync(snap.destDir)) {
    fs.rmSync(snap.destDir, { recursive: true, force: true });
  }
  restoreFileBytesAtomic(snap.indexPath, snap.priorIndex);
  restoreFileBytesAtomic(snap.lockPath, snap.priorLock);
}

/**
 * Publish = install + immutability gate + audit log with actor.
 * Re-publishing the same version with a different digest fails VERSION_IMMUTABLE.
 * Audit-append failure rolls back the just-installed version + index/lock (no partial state).
 */
/**
 * AE-030d/h2 / PD-46 / ADR-012 A6 — publish must declare memorySource.
 * Omitted or unknown memorySource fails closed (no silent private→public).
 * Positively declared public-safe content is allowed; org/private still needs
 * a governed path (approval_ref / governedPublish).
 * @param {object} opts
 */
const MEMORY_SOURCE_PUBLIC_SAFE = new Set(['public-safe', 'first-party', 'external-public']);
const MEMORY_SOURCE_SCOPES = new Set([
  'execution',
  'repository',
  'project',
  'skill',
  'organizational',
  'evaluation',
]);
const MEMORY_SOURCE_VISIBILITIES = new Set(['private', 'local', 'public']);

function assertMemorySourcePublishAllowed(opts) {
  const src = opts && opts.memorySource;
  if (!src || typeof src !== 'object' || Array.isArray(src)) {
    const err = new Error(
      'memorySource is required on publish (omitted source fails closed; declare public-safe or org/private explicitly)'
    );
    err.code = 'MEMORY_SOURCE_REQUIRED';
    err.path = 'memorySource';
    throw err;
  }

  const declaration =
    src.declaration != null ? String(src.declaration).trim().toLowerCase() : '';
  if (src.publicSafe === true || MEMORY_SOURCE_PUBLIC_SAFE.has(declaration)) {
    return;
  }

  const scope = src.scope != null ? String(src.scope).trim() : '';
  const visibility = src.visibility != null ? String(src.visibility).trim() : '';

  if (!scope && !visibility) {
    const err = new Error(
      'unknown memorySource: declare publicSafe/declaration or scope+visibility'
    );
    err.code = 'UNKNOWN_MEMORY_SOURCE';
    err.path = 'memorySource';
    throw err;
  }
  if (scope && !MEMORY_SOURCE_SCOPES.has(scope)) {
    const err = new Error(`unknown memorySource.scope: ${scope}`);
    err.code = 'UNKNOWN_MEMORY_SOURCE';
    err.path = 'memorySource.scope';
    throw err;
  }
  if (visibility && !MEMORY_SOURCE_VISIBILITIES.has(visibility)) {
    const err = new Error(`unknown memorySource.visibility: ${visibility}`);
    err.code = 'UNKNOWN_MEMORY_SOURCE';
    err.path = 'memorySource.visibility';
    throw err;
  }

  const fromPrivateOrg =
    scope === 'organizational' ||
    visibility === 'private' ||
    visibility === 'local';
  if (!fromPrivateOrg) {
    // Known non-private declaration (e.g. visibility public) — allowed.
    return;
  }
  const governed =
    opts.governedPublish === true ||
    (opts.approvalRef != null && String(opts.approvalRef).trim() !== '');
  if (!governed) {
    const err = new Error(
      'publishing skill content sourced from organizational/private memory requires a governed path (approval_ref or governedPublish)'
    );
    err.code = 'PRIVATE_MEMORY_PUBLISH_FORBIDDEN';
    err.path = 'memorySource';
    throw err;
  }
}

/**
 * Resolve AE-032c review input: explicit artifact/path, else sourceDir/publish-review.json.
 * Explicit `reviewArtifact: null` (own property) means missing — fail closed.
 * @param {object} opts
 * @param {string} sourceDir
 */
function resolvePublishReviewInput(opts, sourceDir) {
  // Explicit null (not undefined) means "no review" — fail closed without sidecar fallback.
  if (Object.prototype.hasOwnProperty.call(opts, 'reviewArtifact') && opts.reviewArtifact === null) {
    return null;
  }
  if (opts.reviewArtifact != null) return opts.reviewArtifact;
  if (opts.reviewPath != null && String(opts.reviewPath).trim()) {
    return opts.reviewPath;
  }
  if (!sourceDir) return null;
  const sidecar = path.join(path.resolve(sourceDir), 'publish-review.json');
  if (fs.existsSync(sidecar)) return sidecar;
  return null;
}

function publishSkill(opts) {
  let actor;
  try {
    actor = normalizeActor(opts.actor);
  } catch (err) {
    return { ok: false, code: err.code || 'ACTOR_REQUIRED', errors: [err.message] };
  }

  try {
    assertMemorySourcePublishAllowed(opts);
  } catch (err) {
    return {
      ok: false,
      code: err.code || 'PRIVATE_MEMORY_PUBLISH_FORBIDDEN',
      errors: [err.message],
    };
  }

  const registryRoot = path.resolve(opts.registryRoot);
  const identity = peekPackageIdentity(opts.sourceDir);
  const snap = identity
    ? snapshotPublishState(registryRoot, identity.name, identity.version)
    : null;

  // AE-032c: machine-checkable independent review required before install/publish.
  // When identity is known, bind skill/version; digest checked against installed result below
  // and against package digest when present in the review.
  let packageDigest = null;
  if (opts.sourceDir) {
    try {
      const mPath = path.join(path.resolve(opts.sourceDir), 'manifest.json');
      if (fs.existsSync(mPath)) {
        const parsed = JSON.parse(fs.readFileSync(mPath, 'utf8'));
        packageDigest = parsed && parsed.digest != null ? String(parsed.digest).trim().toLowerCase() : null;
      }
    } catch {
      packageDigest = null;
    }
  }
  const reviewInput = resolvePublishReviewInput(opts, opts.sourceDir);
  const reviewGate = requirePublishReview({
    reviewArtifact: reviewInput,
    skill: identity ? identity.name : undefined,
    version: identity ? identity.version : undefined,
    digest: packageDigest || undefined,
  });
  if (!reviewGate.ok) {
    return {
      ok: false,
      code: reviewGate.code || 'REVIEW_REQUIRED',
      errors: reviewGate.errors || ['review artifact required before publishSkill'],
    };
  }

  // AE-033a / PD-45: when scorecards are supplied, ANY regression blocks publish.
  const compareGate = assertPublishCompareGate({
    ...opts,
    compareSkill: opts.compareSkill || (identity && identity.name),
    compareToVersion: opts.compareToVersion || (identity && identity.version),
  });
  if (!compareGate.ok) {
    return {
      ok: false,
      code: compareGate.code || 'REGRESSION',
      errors: compareGate.errors || (compareGate.regressions || []).map(
        (r) => `[${r.id}] ${r.kind}: ${r.message}`
      ),
      regressions: compareGate.regressions,
    };
  }

  const result = installSkill(opts);
  if (!result.ok) return result;

  // Re-check digest against installed package (fail closed on review/package drift).
  const postReview = requirePublishReview({
    reviewArtifact: reviewGate.review,
    skill: result.manifest.name,
    version: result.manifest.version,
    digest: result.digest,
  });
  if (!postReview.ok) {
    if (snap) {
      try {
        compensatePublishInstall(snap);
      } catch {
        /* best-effort */
      }
    }
    return {
      ok: false,
      code: postReview.code || 'REVIEW_INVALID',
      errors: postReview.errors || ['review digest mismatch after install'],
    };
  }

  const tag = gitTagRef(result.manifest.name, result.manifest.version);
  const approvalRef =
    opts.approvalRef != null && String(opts.approvalRef).trim()
      ? String(opts.approvalRef).trim()
      : undefined;
  try {
    appendRegistryLog(registryRoot, {
      action: 'publish',
      actor,
      name: result.manifest.name,
      version: result.manifest.version,
      digest: result.digest,
      tag,
      approval_ref: approvalRef,
      reviewer: postReview.review.reviewer,
      review_verdict: postReview.review.verdict,
      compare_digest: compareGate.compare_digest,
    });
  } catch (err) {
    return registryLogFailure(err, () => {
      if (!snap) {
        throw new Error('publish compensation unavailable: missing pre-install snapshot');
      }
      compensatePublishInstall(snap);
    });
  }

  return {
    ...result,
    tag,
    actor,
    approvalRef,
    review: postReview.review,
    compare_digest: compareGate.compare_digest,
  };
}

/**
 * Mark a published version deprecated. Still resolvable with a warning record.
 * Audit-append failure restores the prior index (no partial deprecation).
 */
function deprecateSkill(opts) {
  const registryRoot = path.resolve(opts.registryRoot);
  const name = String(opts.name || '').trim();
  const version = String(opts.version || '').trim();
  let actor;
  try {
    actor = normalizeActor(opts.actor);
  } catch (err) {
    return { ok: false, code: err.code || 'ACTOR_REQUIRED', errors: [err.message] };
  }
  if (!name || !version) return { ok: false, code: 'NOT_FOUND' };

  const indexPath = path.join(registryRoot, INDEX_NAME);
  let index;
  try {
    index = readIndex(indexPath);
  } catch (err) {
    return { ok: false, code: err.code || 'INDEX_INVALID', errors: [err.message] };
  }

  const entry = findVersionEntry(index, name, version);
  if (!entry) return { ok: false, code: 'NOT_FOUND' };
  if (versionStatus(entry) === STATUS_REVOKED) {
    return { ok: false, code: 'REVOKED', name, version };
  }

  const priorIndex = structuredClone(index);

  entry.status = STATUS_DEPRECATED;
  entry.deprecated_at = new Date().toISOString();
  entry.deprecated_by = actor;
  if (opts.reason != null && String(opts.reason).trim()) {
    entry.deprecated_reason = String(opts.reason).trim();
  }
  writeIndexAtomic(indexPath, index);

  try {
    appendRegistryLog(registryRoot, {
      action: 'deprecate',
      actor,
      name,
      version,
      digest: entry.manifest && entry.manifest.digest,
      reason: entry.deprecated_reason,
      tag: entry.tag || gitTagRef(name, version),
    });
  } catch (err) {
    return registryLogFailure(err, () => {
      writeIndexAtomic(indexPath, priorIndex);
    });
  }

  return { ok: true, name, version, status: STATUS_DEPRECATED, actor };
}

/**
 * Revoke a version: blocks NEW installs; does not delete already-installed files.
 * Dependency resolve will not newly select a revoked version.
 * Audit-append failure restores prior index + revocation list (no partial revoke).
 */
function revokeSkill(opts) {
  const registryRoot = path.resolve(opts.registryRoot);
  const name = String(opts.name || '').trim();
  const version = String(opts.version || '').trim();
  let actor;
  try {
    actor = normalizeActor(opts.actor);
  } catch (err) {
    return { ok: false, code: err.code || 'ACTOR_REQUIRED', errors: [err.message] };
  }
  if (!name || !version) return { ok: false, code: 'NOT_FOUND' };

  const indexPath = path.join(registryRoot, INDEX_NAME);
  const revocationPath = path.join(registryRoot, REVOCATION_NAME);

  let index;
  let revocation;
  try {
    index = readIndex(indexPath);
    revocation = readRevocation(revocationPath);
  } catch (err) {
    return { ok: false, code: err.code || 'REGISTRY_INVALID', errors: [err.message] };
  }

  const entry = findVersionEntry(index, name, version);
  if (!entry) return { ok: false, code: 'NOT_FOUND' };

  const priorIndex = structuredClone(index);
  const priorRevocation = structuredClone(revocation);
  const revocationExisted = fs.existsSync(revocationPath);

  entry.status = STATUS_REVOKED;
  entry.revoked_at = new Date().toISOString();
  entry.revoked_by = actor;
  if (opts.reason != null && String(opts.reason).trim()) {
    entry.revoked_reason = String(opts.reason).trim();
  }
  writeIndexAtomic(indexPath, index);

  if (!isRevokedInList(revocation, name, version)) {
    revocation.entries.push({
      name,
      version,
      digest: entry.manifest && entry.manifest.digest,
      revoked_at: entry.revoked_at,
      revoked_by: actor,
      reason: entry.revoked_reason || undefined,
      tag: entry.tag || gitTagRef(name, version),
    });
    writeRevocationAtomic(revocationPath, revocation);
  }

  try {
    appendRegistryLog(registryRoot, {
      action: 'revoke',
      actor,
      name,
      version,
      digest: entry.manifest && entry.manifest.digest,
      reason: entry.revoked_reason,
      tag: entry.tag || gitTagRef(name, version),
    });
  } catch (err) {
    return registryLogFailure(err, () => {
      writeIndexAtomic(indexPath, priorIndex);
      if (!revocationExisted) {
        if (fs.existsSync(revocationPath)) fs.rmSync(revocationPath, { force: true });
      } else {
        writeRevocationAtomic(revocationPath, priorRevocation);
      }
    });
  }

  const installedPath = path.join(registryRoot, 'skills', name, version);
  return {
    ok: true,
    name,
    version,
    status: STATUS_REVOKED,
    actor,
    // Document already-installed behavior (ADR / M3.2): files remain; new installs blocked.
    already_installed: fs.existsSync(installedPath)
      ? 'retained; new installs blocked'
      : 'none',
  };
}

/**
 * Resolve from registry and verify lock pin.
 */
function resolveAndVerify(registryRoot, name, range) {
  const root = path.resolve(registryRoot);
  let index;
  let revocation;
  try {
    index = readIndex(path.join(root, INDEX_NAME));
    revocation = readRevocation(path.join(root, REVOCATION_NAME));
  } catch (err) {
    return { ok: false, code: err.code || 'REGISTRY_INVALID', errors: [err.message] };
  }
  const r = resolve(name, range, index, { revocation });
  if (!r.ok) return r;
  const lockPath = path.join(root, LOCKFILE_NAME);
  if (!fs.existsSync(lockPath)) return { ok: false, code: 'LOCK_NOT_FOUND' };
  let lock;
  try {
    lock = readLockfile(lockPath);
  } catch (err) {
    return { ok: false, code: 'LOCKFILE_INVALID', errors: [err.message] };
  }
  const skillDir = path.join(root, 'skills', name, r.version);
  const raw = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  const pin = resolveLockPin(lock, name, raw);
  if (!pin.ok) return pin;
  return {
    ok: true,
    manifest: r.manifest,
    version: r.version,
    digest: pin.digest,
    status: r.status,
    warning: r.warning,
  };
}

module.exports = {
  INDEX_NAME,
  REVOCATION_NAME,
  REGISTRY_LOG_NAME,
  STATUS_ACTIVE,
  STATUS_DEPRECATED,
  STATUS_REVOKED,
  emptyIndex,
  emptyRevocation,
  readIndex,
  writeIndexAtomic,
  readRevocation,
  writeRevocationAtomic,
  gitTagRef,
  appendRegistryLog,
  readRegistryLog,
  resolve,
  validateDependencies,
  installSkill,
  publishSkill,
  assertMemorySourcePublishAllowed,
  MEMORY_SOURCE_PUBLIC_SAFE,
  MEMORY_SOURCE_SCOPES,
  MEMORY_SOURCE_VISIBILITIES,
  deprecateSkill,
  revokeSkill,
  resolveAndVerify,
  scanInstallPackage,
};
