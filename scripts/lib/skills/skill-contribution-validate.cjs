'use strict';

/**
 * AE-028a: validate a skill contribution package (templates / CI gate).
 * Layer: skills (service). No tools/ require. No external publish path.
 *
 * Package layout (contribution):
 *   <dir>/SKILL.md        required
 *   <dir>/manifest.json   required (schema-valid; digest required + must match body)
 *   <dir>/contract.test.js optional; when present must exit 0 under node --test
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { extractFrontmatter, parseSimpleFields } = require('../catalog/parse-frontmatter.cjs');
const { validateSkillManifest } = require('./skill-manifest.cjs');
const { digestSkillBody, verifySkillDigest } = require('./skill-integrity.cjs');

const SKILL_NAME_RE = /^[a-z0-9-]{1,64}$/;
const BANNED_INSTALL_FILES = ['postinstall.js', 'install.js', 'preinstall.js'];

/**
 * @typedef {{
 *   ok: boolean,
 *   code?: string,
 *   path: string,
 *   name?: string,
 *   digest?: string,
 *   errors: string[],
 *   checks: Array<{ id: string, ok: boolean, detail?: string }>,
 * }} ContributionValidationResult
 */

function pushCheck(checks, id, ok, detail) {
  checks.push({ id, ok, detail: detail || undefined });
}

function fail(result, code, message) {
  result.ok = false;
  result.code = result.code || code;
  if (message) result.errors.push(message);
  return result;
}

/**
 * Validate one contribution directory. Fail closed on missing/corrupt/blank data.
 * @param {string} contributionDir
 * @param {{ runTests?: boolean, execPath?: string, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {ContributionValidationResult}
 */
function validateSkillContribution(contributionDir, opts = {}) {
  const runTests = opts.runTests !== false;
  const abs = path.resolve(contributionDir);
  /** @type {ContributionValidationResult} */
  const result = { ok: true, path: abs, errors: [], checks: [] };

  if (!contributionDir || !String(contributionDir).trim()) {
    pushCheck(result.checks, 'path', false, 'blank path');
    return fail(result, 'PATH_BLANK', 'contribution path is blank');
  }

  let st;
  try {
    st = fs.statSync(abs);
  } catch (err) {
    pushCheck(result.checks, 'path', false, err.message);
    return fail(result, 'PATH_MISSING', `contribution path missing: ${abs}`);
  }
  if (!st.isDirectory()) {
    pushCheck(result.checks, 'path', false, 'not a directory');
    return fail(result, 'PATH_NOT_DIR', `contribution path is not a directory: ${abs}`);
  }
  pushCheck(result.checks, 'path', true);

  const dirName = path.basename(abs);
  const skillMdPath = path.join(abs, 'SKILL.md');
  const manifestPath = path.join(abs, 'manifest.json');

  if (!fs.existsSync(skillMdPath)) {
    pushCheck(result.checks, 'skill_md', false, 'missing SKILL.md');
    return fail(result, 'SKILL_MD_MISSING', `${abs}: missing SKILL.md`);
  }
  let raw;
  try {
    raw = fs.readFileSync(skillMdPath, 'utf8');
  } catch (err) {
    pushCheck(result.checks, 'skill_md', false, err.message);
    return fail(result, 'SKILL_MD_UNREADABLE', `${abs}: cannot read SKILL.md: ${err.message}`);
  }
  if (!String(raw).trim()) {
    pushCheck(result.checks, 'skill_md', false, 'blank SKILL.md');
    return fail(result, 'SKILL_MD_BLANK', `${abs}: SKILL.md is blank`);
  }
  const ex = extractFrontmatter(raw);
  if (!ex) {
    pushCheck(result.checks, 'skill_md', false, 'missing frontmatter');
    return fail(result, 'SKILL_MD_FRONTMATTER', `${abs}: SKILL.md missing frontmatter`);
  }
  const fm = parseSimpleFields(ex.block);
  const fmName = fm.name && String(fm.name).trim();
  if (!fmName) {
    pushCheck(result.checks, 'skill_md', false, 'missing name');
    return fail(result, 'SKILL_MD_NAME', `${abs}: SKILL.md missing name`);
  }
  if (!SKILL_NAME_RE.test(fmName)) {
    pushCheck(result.checks, 'skill_md', false, `invalid name ${fmName}`);
    return fail(result, 'SKILL_MD_NAME', `${abs}: invalid skill name "${fmName}"`);
  }
  if (fmName !== dirName) {
    pushCheck(result.checks, 'skill_md', false, `name ${fmName} != dir ${dirName}`);
    return fail(
      result,
      'SKILL_DIR_MISMATCH',
      `${abs}: SKILL.md name "${fmName}" must match directory "${dirName}"`
    );
  }
  pushCheck(result.checks, 'skill_md', true, fmName);
  result.name = fmName;

  if (!fs.existsSync(manifestPath)) {
    pushCheck(result.checks, 'manifest', false, 'missing manifest.json');
    return fail(result, 'MANIFEST_MISSING', `${abs}: missing manifest.json`);
  }
  let manifest;
  try {
    const text = fs.readFileSync(manifestPath, 'utf8');
    if (!String(text).trim()) {
      pushCheck(result.checks, 'manifest', false, 'blank manifest.json');
      return fail(result, 'MANIFEST_BLANK', `${abs}: manifest.json is blank`);
    }
    manifest = JSON.parse(text);
  } catch (err) {
    pushCheck(result.checks, 'manifest', false, err.message);
    return fail(result, 'MANIFEST_PARSE', `${abs}: manifest.json parse failed: ${err.message}`);
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    pushCheck(result.checks, 'manifest', false, 'not an object');
    return fail(result, 'MANIFEST_INVALID', `${abs}: manifest.json must be an object`);
  }

  // Contribution gate requires an explicit digest before schema (Ajv would otherwise
  // reject blank/whitespace with MANIFEST_INVALID and skip the named DIGEST_MISSING code).
  const digestField = manifest.digest;
  if (digestField == null || !String(digestField).trim()) {
    pushCheck(result.checks, 'digest', false, 'DIGEST_MISSING');
    return fail(
      result,
      'DIGEST_MISSING',
      `${abs}: manifest.digest is required for skill contributions (sha256 of SKILL.md body)`
    );
  }

  const validated = validateSkillManifest(manifest);
  if (!validated.ok) {
    for (const e of validated.errors || []) result.errors.push(`${abs}/manifest.json: ${e}`);
    pushCheck(result.checks, 'manifest', false, validated.code);
    result.ok = false;
    result.code = result.code || validated.code || 'MANIFEST_INVALID';
    return result;
  }
  if (manifest.name !== fmName) {
    pushCheck(result.checks, 'manifest', false, 'name mismatch');
    return fail(
      result,
      'MANIFEST_NAME_MISMATCH',
      `${abs}: manifest.name "${manifest.name}" must match SKILL.md name "${fmName}"`
    );
  }
  pushCheck(result.checks, 'manifest', true);

  const verified = verifySkillDigest(raw, digestField);
  if (!verified.ok) {
    pushCheck(result.checks, 'digest', false, verified.code);
    result.digest = verified.digest;
    return fail(
      result,
      verified.code || 'DIGEST_MISMATCH',
      `${abs}: content digest ${verified.code}` +
        (verified.digest ? ` (got ${verified.digest}, expected ${verified.expected})` : '')
    );
  }
  result.digest = verified.digest;
  pushCheck(result.checks, 'digest', true, verified.digest);

  for (const banned of BANNED_INSTALL_FILES) {
    if (fs.existsSync(path.join(abs, banned))) {
      pushCheck(result.checks, 'install_scripts', false, banned);
      return fail(result, 'INSTALL_SCRIPTS_FORBIDDEN', `${abs}: banned file ${banned}`);
    }
  }
  const pkgPath = path.join(abs, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg && pkg.scripts && typeof pkg.scripts === 'object' && Object.keys(pkg.scripts).length) {
        pushCheck(result.checks, 'install_scripts', false, 'package.json scripts');
        return fail(result, 'INSTALL_SCRIPTS_FORBIDDEN', `${abs}: package.json scripts are forbidden`);
      }
    } catch (err) {
      pushCheck(result.checks, 'install_scripts', false, err.message);
      return fail(result, 'INSTALL_SCRIPTS_FORBIDDEN', `${abs}: package.json unreadable: ${err.message}`);
    }
  }
  pushCheck(result.checks, 'install_scripts', true);

  const contractPath = path.join(abs, 'contract.test.js');
  if (fs.existsSync(contractPath)) {
    if (!runTests) {
      pushCheck(result.checks, 'contract_test', true, 'skipped (runTests=false)');
    } else {
      const execPath = opts.execPath || process.execPath;
      // Drop NODE_TEST_CONTEXT so a nested `node --test <one file>` actually runs
      // when this validator is invoked from inside the pack's own test suite.
      const baseEnv = opts.env || process.env;
      const childEnv = { ...baseEnv };
      delete childEnv.NODE_TEST_CONTEXT;
      const r = spawnSync(execPath, ['--test', contractPath], {
        cwd: abs,
        encoding: 'utf8',
        env: childEnv,
        shell: false,
      });
      if (r.error) {
        pushCheck(result.checks, 'contract_test', false, r.error.message);
        return fail(result, 'CONTRACT_TEST_FAILED', `${abs}: contract.test.js spawn failed: ${r.error.message}`);
      }
      if (r.status !== 0) {
        const tail = [r.stdout, r.stderr].filter(Boolean).join('\n').trim().slice(-800);
        pushCheck(result.checks, 'contract_test', false, `exit ${r.status}`);
        return fail(
          result,
          'CONTRACT_TEST_FAILED',
          `${abs}: contract.test.js failed (exit ${r.status})` + (tail ? `\n${tail}` : '')
        );
      }
      pushCheck(result.checks, 'contract_test', true);
    }
  } else {
    pushCheck(result.checks, 'contract_test', true, 'absent (optional)');
  }

  return result;
}

/**
 * Format a result for CI check output (human-readable, stable keys).
 * @param {ContributionValidationResult} result
 * @returns {string}
 */
function formatContributionResult(result) {
  const lines = [];
  const status = result.ok ? 'PASS' : 'FAIL';
  lines.push(`skill-contribution-validate: ${status} ${result.path}`);
  if (result.name) lines.push(`  name: ${result.name}`);
  if (result.digest) lines.push(`  digest: ${result.digest}`);
  if (result.code) lines.push(`  code: ${result.code}`);
  for (const c of result.checks || []) {
    lines.push(`  check ${c.id}: ${c.ok ? 'ok' : 'FAIL'}${c.detail ? ` (${c.detail})` : ''}`);
  }
  for (const e of result.errors || []) {
    lines.push(`  - ${e}`);
  }
  return lines.join('\n');
}

/**
 * Resolve bundled self-check fixtures relative to pack root.
 * @param {string} pluginRoot
 * @returns {{ good: string, broken: string[] }}
 */
function contributionFixturePaths(pluginRoot) {
  const base = path.join(pluginRoot, 'test', 'fixtures', 'skill-contribution');
  return {
    good: path.join(base, 'good', 'contrib-good-example'),
    broken: [
      path.join(base, 'broken-digest', 'contrib-broken-digest'),
      path.join(base, 'broken-manifest', 'contrib-broken-manifest'),
      path.join(base, 'blank-digest', 'contrib-blank-digest'),
      path.join(base, 'corrupt-manifest', 'contrib-corrupt-manifest'),
      path.join(base, 'missing-skill-md', 'contrib-missing-skill-md'),
      path.join(base, 'broken-contract', 'contrib-broken-contract'),
    ],
  };
}

/**
 * Self-check used by `npm run verify`: good fixture must pass; each broken must fail.
 * @param {string} pluginRoot
 * @param {{ runTests?: boolean }} [opts]
 * @returns {{ ok: boolean, results: ContributionValidationResult[], summary: string }}
 */
function runContributionSelfCheck(pluginRoot, opts = {}) {
  const fixtures = contributionFixturePaths(pluginRoot);
  const results = [];
  const lines = [];

  const good = validateSkillContribution(fixtures.good, opts);
  results.push(good);
  lines.push(formatContributionResult(good));
  if (!good.ok) {
    lines.push('skill-contribution-validate: self-check FAILED — good fixture must pass');
    return { ok: false, results, summary: lines.join('\n') };
  }

  for (const broken of fixtures.broken) {
    const r = validateSkillContribution(broken, opts);
    results.push(r);
    lines.push(formatContributionResult(r));
    if (r.ok) {
      lines.push(`skill-contribution-validate: self-check FAILED — expected fail for ${broken}`);
      return { ok: false, results, summary: lines.join('\n') };
    }
  }

  lines.push(
    `skill-contribution-validate: self-check OK (1 good + ${fixtures.broken.length} broken fixtures)`
  );
  return { ok: true, results, summary: lines.join('\n') };
}

module.exports = {
  validateSkillContribution,
  formatContributionResult,
  contributionFixturePaths,
  runContributionSelfCheck,
};
