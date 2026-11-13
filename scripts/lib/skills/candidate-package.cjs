'use strict';

/**
 * AE-032b: deterministic skill-candidate packages (templates only; PD-45 / PD-9).
 * Writes under <project>/.agentic-swe/skills/candidates/<skill>/ — never pack main.
 * Layer: skills (service). No LLM. No network.
 */

const fs = require('node:fs');
const path = require('node:path');
const { digestSkillBody } = require('./skill-integrity.cjs');
const { validateSkillContribution } = require('./skill-contribution-validate.cjs');

const CANDIDATES_REL = path.join('.agentic-swe', 'skills', 'candidates');
const SKILL_NAME_RE = /^[a-z0-9-]{1,64}$/;

/**
 * @param {string} projectRoot
 * @returns {string}
 */
function candidatesRoot(projectRoot) {
  return path.join(path.resolve(projectRoot), CANDIDATES_REL);
}

/**
 * Escape a string for YAML double-quoted scalars.
 * @param {string} s
 */
function yamlQuote(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, ' ');
}

/**
 * Build SKILL.md from procedure / candidate metadata (template only).
 * @param {{
 *   skill: string,
 *   verify_command: string,
 *   kind?: string,
 *   candidate_id?: string,
 *   quarantined?: boolean
 * }} candidate
 * @returns {string}
 */
function renderSkillMd(candidate) {
  const name = String(candidate.skill || '').trim();
  const cmd = String(candidate.verify_command || '').trim();
  const kind = String(candidate.kind || 'ritual');
  const body = [
    `# ${name}`,
    '',
    'Deterministic candidate stub generated from procedure metadata (AE-032b).',
    'Status: **candidate** / eval_status: **unevaluated**. Not trusted for autonomous selection.',
    '',
    '## Procedure',
    '',
    `- Ritual kind: \`${kind}\``,
    `- Verify command: \`${cmd || '(none)'}\``,
    candidate.candidate_id ? `- Candidate id: \`${candidate.candidate_id}\`` : null,
    candidate.quarantined ? '- Quarantine: external/untrusted source — do not promote without review' : null,
    '',
    '## Notes',
    '',
    'Generated from templates only (PD-45). No LLM prose. Promote via human-gated review (AE-032c / FD-B).',
    '',
  ]
    .filter((line) => line !== null)
    .join('\n');

  return [
    '---',
    `name: ${name}`,
    `description: "Candidate skill stub for ritual ${yamlQuote(cmd || name)} (unevaluated)."`,
    'metadata:',
    `  version: "${yamlQuote(candidate.version || '0.0.0-candidate')}"`,
    '  eval_status: "unevaluated"',
    `  eval_ref: "${yamlQuote(candidate.eval_ref || '')}"`,
    '  status: "candidate"',
    '  autonomous_selection: "false"',
    '---',
    body,
  ].join('\n');
}

/**
 * CONTRACT.md template from procedure metadata.
 * @param {{ skill: string, verify_command: string, kind?: string }} candidate
 */
function renderContractMd(candidate) {
  const name = String(candidate.skill || '').trim();
  const cmd = String(candidate.verify_command || '').trim();
  return [
    `# CONTRACT: ${name}`,
    '',
    '## Inputs',
    '',
    '- `project_root` (string, required) — consumer project to run the ritual against',
    '',
    '## Outputs',
    '',
    '- `verify_result` (string) — exit status / summary of the verify command',
    '',
    '## Permissions',
    '',
    '- None declared at candidate stage (`permissions: []`).',
    '- Promotion must not silently expand permissions (PD-45 / AE-033b).',
    '',
    '## Procedure metadata',
    '',
    `- Ritual kind: \`${candidate.kind || 'ritual'}\``,
    `- Verify command: \`${cmd || '(none)'}\``,
    '',
    '## Status',
    '',
    '- Package status: `candidate`',
    '- Eval status: `unevaluated`',
    '- Autonomous selection: **false**',
    '',
  ].join('\n');
}

/**
 * Minimal contract test stub that asserts package shape (template only).
 * @param {{ skill: string }} candidate
 */
function renderContractTest(candidate) {
  const name = String(candidate.skill || '').trim();
  // Keep the stub self-contained; no pack requires from the candidate dir.
  return `'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('${name} candidate contract: package files present', () => {
  const root = __dirname;
  assert.ok(fs.existsSync(path.join(root, 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(root, 'CONTRACT.md')));
  assert.ok(fs.existsSync(path.join(root, 'candidate-meta.json')));
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(m.name, '${name}');
  assert.match(m.digest, /^[a-f0-9]{64}$/);
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'candidate-meta.json'), 'utf8'));
  assert.equal(meta.status, 'candidate');
  assert.equal(meta.eval_status, 'unevaluated');
  assert.equal(meta.autonomous_selection, false);
});
`;
}

/**
 * Build a schema-valid manifest object (digest filled by caller after SKILL.md render).
 * @param {{ skill: string, verify_command: string }} candidate
 * @param {string} digest
 */
function buildManifest(candidate, digest) {
  const name = String(candidate.skill || '').trim();
  const cmd = String(candidate.verify_command || '').trim();
  const version = String(candidate.version || '0.0.0-candidate').trim() || '0.0.0-candidate';
  const permissions = Array.isArray(candidate.permissions) ? [...candidate.permissions] : [];
  return {
    name,
    version,
    description: `Candidate skill stub for ritual ${cmd || name} (unevaluated).`,
    kind: 'prompt',
    inputs: [{ name: 'project_root', type: 'string', required: true }],
    outputs: [{ name: 'verify_result', type: 'string' }],
    dependencies: [],
    permissions,
    runtime: { node: '>=22.0.0' },
    compatibility: { pack: '^3.0.0' },
    validation: { rules: ['schema', 'digest'] },
    provenance: {
      origin: 'first-party',
      license: 'MIT',
      authors: ['agentic-swe-candidate'],
    },
    maintainer: 'agentic-swe',
    digest,
  };
}

/**
 * Materialize one candidate package under .agentic-swe/skills/candidates/<skill>/.
 * Templates only — no LLM. Quarantined candidates are still written with the bit set.
 *
 * @param {{
 *   projectRoot: string,
 *   candidate: {
 *     skill: string,
 *     verify_command: string,
 *     kind?: string,
 *     candidate_id?: string,
 *     quarantined?: boolean,
 *     quarantine_reason?: string|null,
 *     source_evidence?: object[],
 *     status?: string,
 *     eval_status?: string,
 *     autonomous_selection?: boolean
 *   },
 *   validate?: boolean,
 *   runTests?: boolean
 * }} opts
 * @returns {{
 *   ok: boolean,
 *   code?: string,
 *   path?: string,
 *   skill?: string,
 *   status?: string,
 *   eval_status?: string,
 *   autonomous_selection?: boolean,
 *   validation?: object,
 *   errors?: string[]
 * }}
 */
function writeCandidatePackage(opts) {
  const projectRoot = path.resolve(opts.projectRoot || '');
  const candidate = opts.candidate || {};
  const skill = String(candidate.skill || '').trim();
  if (!projectRoot || projectRoot === path.sep) {
    return { ok: false, code: 'PROJECT_ROOT_REQUIRED', errors: ['projectRoot required'] };
  }
  if (!SKILL_NAME_RE.test(skill)) {
    return { ok: false, code: 'SKILL_NAME_INVALID', errors: [`invalid skill name "${skill}"`] };
  }
  if (candidate.autonomous_selection === true) {
    return {
      ok: false,
      code: 'AUTONOMOUS_FORBIDDEN',
      errors: ['candidates must set autonomous_selection=false'],
    };
  }

  const dest = path.join(candidatesRoot(projectRoot), skill);
  fs.mkdirSync(dest, { recursive: true });

  const skillMd = renderSkillMd(candidate);
  const digest = digestSkillBody(skillMd);
  const manifest = buildManifest(candidate, digest);
  const contractMd = renderContractMd(candidate);
  const contractTest = renderContractTest(candidate);
  const meta = {
    candidate_id: candidate.candidate_id || null,
    skill,
    kind: candidate.kind || null,
    version: manifest.version,
    status: 'candidate',
    eval_status: 'unevaluated',
    autonomous_selection: false,
    verify_command: candidate.verify_command || null,
    quarantined: candidate.quarantined === true,
    quarantine_reason: candidate.quarantined ? candidate.quarantine_reason || 'external_source' : null,
    source_evidence: Array.isArray(candidate.source_evidence) ? candidate.source_evidence : [],
    ritual_promote: candidate.ritual_promote === true,
    packaged_at: new Date().toISOString(),
    generator: 'candidate-package.cjs',
    generator_mode: 'templates-only',
  };

  fs.writeFileSync(path.join(dest, 'SKILL.md'), skillMd.endsWith('\n') ? skillMd : `${skillMd}\n`);
  fs.writeFileSync(path.join(dest, 'CONTRACT.md'), contractMd.endsWith('\n') ? contractMd : `${contractMd}\n`);
  fs.writeFileSync(path.join(dest, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(dest, 'contract.test.js'), contractTest);
  fs.writeFileSync(path.join(dest, 'candidate-meta.json'), `${JSON.stringify(meta, null, 2)}\n`);

  if (candidate.evidence && typeof candidate.evidence === 'object') {
    fs.writeFileSync(
      path.join(dest, 'evidence.json'),
      `${JSON.stringify(candidate.evidence, null, 2)}\n`
    );
  }

  const result = {
    ok: true,
    path: dest,
    skill,
    status: 'candidate',
    eval_status: 'unevaluated',
    autonomous_selection: false,
    digest,
  };

  if (opts.validate !== false) {
    const validation = validateSkillContribution(dest, {
      runTests: opts.runTests !== false,
    });
    result.validation = validation;
    if (!validation.ok) {
      return {
        ok: false,
        code: validation.code || 'CONTRIBUTION_INVALID',
        path: dest,
        skill,
        status: 'candidate',
        eval_status: 'unevaluated',
        autonomous_selection: false,
        validation,
        errors: validation.errors || [],
      };
    }
  }

  return result;
}

/**
 * Package every discovered candidate under the project candidates/ tree.
 * @param {{
 *   projectRoot: string,
 *   candidates: object[],
 *   skipQuarantined?: boolean,
 *   validate?: boolean,
 *   runTests?: boolean
 * }} opts
 */
function writeCandidatePackages(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const skipQuarantined = opts.skipQuarantined === true;
  const list = Array.isArray(opts.candidates) ? opts.candidates : [];
  /** @type {Map<string, object>} */
  const bySkill = new Map();
  for (const c of list) {
    if (!c || !c.skill) continue;
    if (skipQuarantined && c.quarantined) continue;
    const prev = bySkill.get(c.skill);
    if (!prev) {
      bySkill.set(c.skill, { ...c, autonomous_selection: false, status: 'candidate', eval_status: 'unevaluated' });
      continue;
    }
    // Merge evidence; prefer quarantine bit if either is set.
    const merged = {
      ...prev,
      ...c,
      status: 'candidate',
      eval_status: 'unevaluated',
      autonomous_selection: false,
      source_evidence: [...(prev.source_evidence || []), ...(c.source_evidence || [])],
      quarantined: prev.quarantined === true || c.quarantined === true,
      quarantine_reason:
        prev.quarantined || c.quarantined
          ? prev.quarantine_reason || c.quarantine_reason || 'external_source'
          : null,
    };
    bySkill.set(c.skill, merged);
  }

  const written = [];
  const errors = [];
  for (const candidate of [...bySkill.values()].sort((a, b) => a.skill.localeCompare(b.skill))) {
    const r = writeCandidatePackage({
      projectRoot,
      candidate,
      validate: opts.validate,
      runTests: opts.runTests,
    });
    if (r.ok) written.push(r);
    else errors.push(r);
  }

  return {
    ok: errors.length === 0,
    candidates_root: candidatesRoot(projectRoot),
    written,
    errors,
    count: written.length,
  };
}

/**
 * List packaged candidates (reads candidate-meta.json when present).
 * @param {string} projectRoot
 */
function listPackagedCandidates(projectRoot) {
  const root = candidatesRoot(projectRoot);
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(root, ent.name);
    const metaPath = path.join(dir, 'candidate-meta.json');
    let meta = null;
    if (fs.existsSync(metaPath)) {
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      } catch {
        meta = null;
      }
    }
    out.push({
      skill: ent.name,
      path: dir,
      status: (meta && meta.status) || 'candidate',
      eval_status: (meta && meta.eval_status) || 'unevaluated',
      autonomous_selection: meta ? meta.autonomous_selection === true : false,
      quarantined: meta ? meta.quarantined === true : false,
      meta,
    });
  }
  return out.sort((a, b) => a.skill.localeCompare(b.skill));
}

/**
 * Hard gate: packaged candidates are never eligible for autonomous selection.
 * @param {{ projectRoot: string, skillName: string }} opts
 */
function isCandidateAutonomousAllowed(opts) {
  const skillName = String(opts.skillName || '').trim();
  if (!skillName) return { allowed: false, reason: 'SKILL_BLANK' };
  const packaged = listPackagedCandidates(opts.projectRoot).find((c) => c.skill === skillName);
  if (!packaged) return { allowed: false, reason: 'NOT_A_PACKAGED_CANDIDATE', skill: skillName };
  if (packaged.autonomous_selection === true) {
    return { allowed: false, reason: 'CANDIDATE_AUTONOMOUS_BIT_INVALID', skill: skillName };
  }
  if (packaged.status !== 'candidate' || packaged.eval_status !== 'unevaluated') {
    return {
      allowed: false,
      reason: 'CANDIDATE_STATUS_GATE',
      skill: skillName,
      status: packaged.status,
      eval_status: packaged.eval_status,
    };
  }
  return {
    allowed: false,
    reason: 'CANDIDATE_UNEVALUATED',
    skill: skillName,
    status: packaged.status,
    eval_status: packaged.eval_status,
    autonomous_selection: false,
  };
}

module.exports = {
  CANDIDATES_REL,
  candidatesRoot,
  renderSkillMd,
  renderContractMd,
  renderContractTest,
  buildManifest,
  writeCandidatePackage,
  writeCandidatePackages,
  listPackagedCandidates,
  isCandidateAutonomousAllowed,
};
