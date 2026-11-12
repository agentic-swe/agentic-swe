'use strict';

/**
 * AE-029a: first-party skill library checklist, contract verification, and
 * deterministic eval attestation (ADR-010 / PD-9). Layer: skills (service).
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  digestSkillBody,
  verifySkillDigest,
  checkEvalAttestation,
  sha256Text,
} = require('./skill-integrity.cjs');
const { validateSkillManifest, loadManifestFile } = require('./skill-manifest.cjs');

const LIBRARY_CONFIG = 'config/first-party-skill-library.json';
const SUITE_ID = 'ae-029a-first-party-contracts';
const REQUIRED_DOMAINS = Object.freeze([
  'Development',
  'Testing',
  'Code review',
  'Security',
  'Architecture',
  'Documentation',
  'CI/CD',
  'Repository analysis',
]);

/**
 * @param {string} pluginRoot
 * @returns {object}
 */
function loadFirstPartyLibrary(pluginRoot) {
  const file = path.join(path.resolve(pluginRoot), LIBRARY_CONFIG);
  if (!fs.existsSync(file)) {
    const err = new Error(`first-party skill library missing: ${LIBRARY_CONFIG}`);
    err.code = 'LIBRARY_MISSING';
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    const e = new Error(`first-party skill library parse failed: ${err.message}`);
    e.code = 'LIBRARY_INVALID';
    e.cause = err;
    throw e;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const err = new Error('first-party skill library must be an object');
    err.code = 'LIBRARY_INVALID';
    throw err;
  }
  if (!Array.isArray(parsed.skills) || parsed.skills.length < 10) {
    const err = new Error('first-party skill library requires >=10 skills');
    err.code = 'LIBRARY_INCOMPLETE';
    throw err;
  }
  for (const row of parsed.skills) {
    if (!row || typeof row !== 'object') {
      const err = new Error('library skill entry must be object');
      err.code = 'LIBRARY_INVALID';
      throw err;
    }
    const name = String(row.name || '').trim();
    const domain = String(row.domain || '').trim();
    if (!name || !domain) {
      const err = new Error('library skill entry requires non-blank name and domain');
      err.code = 'LIBRARY_INVALID';
      throw err;
    }
  }
  return parsed;
}

/**
 * Canonical contract payload used for AE-024b-compatible result_digest.
 * @param {{ name: string, domain: string }} skillEntry
 * @param {object} manifest
 */
function contractCanonical(skillEntry, manifest) {
  return JSON.stringify({
    name: skillEntry.name,
    domain: skillEntry.domain,
    inputs: manifest.inputs,
    outputs: manifest.outputs,
    permissions: manifest.permissions,
    validation: manifest.validation,
  });
}

/**
 * Compute suite result digest from library entries + on-disk manifests.
 * Fail-closed on missing/invalid data (does not swallow parse errors).
 * @param {string} pluginRoot
 * @param {object} [library]
 */
function computeLibraryAttestationDigest(pluginRoot, library) {
  const lib = library || loadFirstPartyLibrary(pluginRoot);
  const parts = [];
  for (const skillEntry of lib.skills) {
    const skillDir = path.join(path.resolve(pluginRoot), 'skills', skillEntry.name);
    const loaded = loadManifestFile(skillDir);
    if (!loaded) {
      const err = new Error(`manifest.json missing for ${skillEntry.name}`);
      err.code = 'MANIFEST_MISSING';
      throw err;
    }
    if (!loaded.ok) {
      const err = new Error(`manifest invalid for ${skillEntry.name}: ${(loaded.errors || []).join('; ')}`);
      err.code = loaded.code || 'MANIFEST_INVALID';
      throw err;
    }
    parts.push(contractCanonical(skillEntry, loaded.manifest));
  }
  return sha256Text(parts.join('\n'));
}

/**
 * Verify one first-party library skill end-to-end (contract + digest + attestation).
 * @returns {{ ok: true, skill: string, domain: string } | { ok: false, skill: string, code: string, errors: string[] }}
 */
function verifyFirstPartySkill(pluginRoot, skillEntry) {
  const name = String(skillEntry && skillEntry.name ? skillEntry.name : '').trim();
  const domain = String(skillEntry && skillEntry.domain ? skillEntry.domain : '').trim();
  if (!name || !domain) {
    return { ok: false, skill: name || '(blank)', code: 'LIBRARY_INVALID', errors: ['blank name or domain'] };
  }

  const skillDir = path.join(path.resolve(pluginRoot), 'skills', name);
  const skillMd = path.join(skillDir, 'SKILL.md');
  const contractMd = path.join(skillDir, 'CONTRACT.md');
  const attPath = path.join(skillDir, 'eval-attestation.json');
  const errors = [];

  if (!fs.existsSync(skillMd)) {
    return { ok: false, skill: name, code: 'SKILL_MISSING', errors: ['SKILL.md missing'] };
  }
  if (!fs.existsSync(contractMd)) {
    errors.push('CONTRACT.md missing');
  } else {
    const contractBody = fs.readFileSync(contractMd, 'utf8');
    if (!contractBody.trim()) errors.push('CONTRACT.md blank');
    if (!/Inputs/i.test(contractBody) || !/Outputs/i.test(contractBody) || !/Permissions/i.test(contractBody)) {
      errors.push('CONTRACT.md missing Inputs/Outputs/Permissions sections');
    }
    // PD-9: contracts must not require paid provider calls for evaluation.
    if (
      /\b(openai|anthropic)\b/i.test(contractBody) ||
      /\b(gpt-4|claude-3)\b/i.test(contractBody) ||
      /\brequires?\s+paid\s+llm\b/i.test(contractBody) ||
      /\bapi[_-]?key\b/i.test(contractBody)
    ) {
      errors.push('CONTRACT.md must not require paid LLM (PD-9)');
    }
  }

  const loaded = loadManifestFile(skillDir);
  if (!loaded) {
    return { ok: false, skill: name, code: 'MANIFEST_MISSING', errors: [...errors, 'manifest.json missing'] };
  }
  if (!loaded.ok) {
    return {
      ok: false,
      skill: name,
      code: loaded.code || 'MANIFEST_INVALID',
      errors: [...errors, ...(loaded.errors || [])],
    };
  }
  const manifest = loaded.manifest;
  if (manifest.name !== name) {
    errors.push(`manifest.name "${manifest.name}" !== skill "${name}"`);
  }
  if (!Array.isArray(manifest.inputs) || !Array.isArray(manifest.outputs)) {
    errors.push('manifest inputs/outputs must be arrays');
  }
  if (!Array.isArray(manifest.permissions)) {
    errors.push('manifest permissions must be explicit array');
  }

  const raw = fs.readFileSync(skillMd, 'utf8');
  const digest = String(manifest.digest || '').trim().toLowerCase();
  if (!digest) {
    // Present-but-blank digest is tampering, not "optional".
    errors.push('manifest.digest blank');
  } else {
    const v = verifySkillDigest(raw, digest);
    if (!v.ok) errors.push(`digest ${v.code} (expected ${digest.slice(0, 12)}… got ${(v.digest || '').slice(0, 12)}…)`);
  }

  let sidecarAtt = null;
  if (!fs.existsSync(attPath)) {
    errors.push('eval-attestation.json missing');
  } else {
    try {
      sidecarAtt = JSON.parse(fs.readFileSync(attPath, 'utf8'));
    } catch (err) {
      errors.push(`eval-attestation.json parse failed: ${err.message}`);
    }
  }

  const candidate = manifest.eval_attestation || sidecarAtt;
  const att = checkEvalAttestation(candidate);
  if (!att.ok) {
    errors.push(`eval attestation ${att.code}`);
  } else if (candidate.suite_id !== SUITE_ID) {
    errors.push(`eval attestation suite_id must be ${SUITE_ID}`);
  }

  // Self-declared frontmatter eval_status alone is never enough — sidecar/manifest attestation required above.
  if (errors.length) {
    return { ok: false, skill: name, code: 'CONTRACT_INVALID', errors };
  }
  return { ok: true, skill: name, domain, digest: digestSkillBody(raw), attestation: candidate };
}

/**
 * Verify the full AE-029a library: domain coverage, per-skill contracts, suite digest match.
 * @param {string} pluginRoot
 */
function verifyFirstPartyLibrary(pluginRoot) {
  const lib = loadFirstPartyLibrary(pluginRoot);
  const domains = new Set();
  const results = [];
  const errors = [];

  for (const entry of lib.skills) {
    const r = verifyFirstPartySkill(pluginRoot, entry);
    results.push(r);
    if (!r.ok) {
      errors.push(`${r.skill}: ${r.code} — ${(r.errors || []).join('; ')}`);
      continue;
    }
    domains.add(r.domain);
  }

  for (const d of REQUIRED_DOMAINS) {
    if (!domains.has(d)) errors.push(`missing domain coverage: ${d}`);
  }

  let expectedDigest;
  try {
    expectedDigest = computeLibraryAttestationDigest(pluginRoot, lib);
  } catch (err) {
    errors.push(`attestation digest compute failed: ${err.code || err.message}`);
  }

  const pinned = lib.attestation && String(lib.attestation.result_digest || '').trim().toLowerCase();
  if (!pinned) {
    errors.push('library.attestation.result_digest blank or missing');
  } else if (expectedDigest && pinned !== expectedDigest) {
    errors.push(`library attestation digest mismatch (pinned ${pinned.slice(0, 12)}… vs ${expectedDigest.slice(0, 12)}…)`);
  }

  // Gate-time vs write-time: each skill's eval-attestation must match recomputed suite digest.
  if (expectedDigest) {
    for (const entry of lib.skills) {
      const attPath = path.join(path.resolve(pluginRoot), 'skills', entry.name, 'eval-attestation.json');
      if (!fs.existsSync(attPath)) continue;
      let att;
      try {
        att = JSON.parse(fs.readFileSync(attPath, 'utf8'));
      } catch (err) {
        errors.push(`${entry.name}: attestation parse at gate: ${err.message}`);
        continue;
      }
      const dig = String(att.result_digest || '').trim().toLowerCase();
      if (!dig) {
        errors.push(`${entry.name}: attestation result_digest blank at gate`);
      } else if (dig !== expectedDigest) {
        errors.push(`${entry.name}: attestation result_digest stale vs suite`);
      }
    }
  }

  return {
    ok: errors.length === 0 && results.every((r) => r.ok),
    total: lib.skills.length,
    domains: [...domains].sort(),
    required_domains: [...REQUIRED_DOMAINS],
    results,
    errors,
    attestation_digest: expectedDigest || null,
  };
}

module.exports = {
  LIBRARY_CONFIG,
  SUITE_ID,
  REQUIRED_DOMAINS,
  loadFirstPartyLibrary,
  contractCanonical,
  computeLibraryAttestationDigest,
  verifyFirstPartySkill,
  verifyFirstPartyLibrary,
};
