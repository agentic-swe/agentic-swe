'use strict';

/**
 * AE-029b: invoke first-party skills through the AE-025 local registry under
 * the AE-027 process sandbox profile (PD-31). Layer: hosted-runtime (runtime).
 *
 * Does not require tools from the skills layer (ADR-016). Sandbox API is
 * injected or loaded from scripts/lib/tools/sandbox-profile.cjs — no parallel
 * sandbox is invented here. Invokes are deterministic/offline (PD-9).
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { appendEvent, readJournal } = require('../shared/journal.cjs');
const { recordPolicyDecision } = require('../policy/record-decision.cjs');
const {
  installSkill,
  resolveAndVerify,
  INDEX_NAME,
} = require('../skills/skill-registry.cjs');
const { loadFirstPartyLibrary } = require('../skills/first-party-library.cjs');
const { verifySkillDigest } = require('../skills/skill-integrity.cjs');

function loadSandboxApi(injected) {
  if (injected) return injected;
  // Fail closed if AE-027a sandbox module is absent (do not invent a parallel sandbox).
  // Static require keeps layer-lint happy; MODULE_NOT_FOUND → SANDBOX_UNAVAILABLE.
  try {
    return require('../tools/sandbox-profile.cjs');
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND') {
      const e = new Error('AE-027 sandbox-profile.cjs missing; cannot invoke skills');
      e.code = 'SANDBOX_UNAVAILABLE';
      e.cause = err;
      throw e;
    }
    throw err;
  }
}

function allowDecision(extra = {}) {
  return {
    decision: 'allow',
    rule_id: extra.rule_id || 'ae-029b.skill-invoke.allow',
    policy_digest: extra.policy_digest || 'b'.repeat(64),
    risk_class: extra.risk_class || 'low',
    reason: extra.reason || 'AE-029b fixture invoke under process sandbox',
    code: 'ALLOW',
    ...extra,
  };
}

/**
 * Install pack first-party skills into a registry root (atomic AE-025a install).
 * @param {{ pluginRoot: string, registryRoot: string, skills?: string[] }} opts
 */
function installFirstPartyLibraryIntoRegistry(opts) {
  const pluginRoot = path.resolve(opts.pluginRoot);
  const registryRoot = path.resolve(opts.registryRoot);
  const lib = loadFirstPartyLibrary(pluginRoot);
  const names = Array.isArray(opts.skills) && opts.skills.length
    ? opts.skills
    : lib.skills.map((s) => s.name);
  const installed = [];
  for (const name of names) {
    const sourceDir = path.join(pluginRoot, 'skills', name);
    if (!fs.existsSync(path.join(sourceDir, 'manifest.json'))) {
      return { ok: false, code: 'SOURCE_INVALID', errors: [`${name}: manifest.json missing`] };
    }
    const r = installSkill({ registryRoot, sourceDir });
    if (!r.ok) return { ok: false, skill: name, code: r.code, errors: r.errors || [r.message].filter(Boolean) };
    installed.push({ name, version: r.version || r.manifest && r.manifest.version, digest: r.digest });
  }
  return { ok: true, installed, indexPath: path.join(registryRoot, INDEX_NAME) };
}

/**
 * Deterministic offline invoke: resolve+verify via registry, PDP record, then
 * spawn a sandboxed node one-liner that re-checks digest and prints JSON.
 *
 * @param {{
 *   registryRoot: string,
 *   skillName: string,
 *   range?: string,
 *   workDir: string,
 *   fixtureRoot: string,
 *   decision?: object,
 *   sandboxApi?: object,
 *   spawn?: Function,
 * }} opts
 */
async function invokeSkillViaRegistry(opts) {
  const registryRoot = path.resolve(opts.registryRoot);
  const skillName = String(opts.skillName || '').trim();
  const range = opts.range || '*';
  const workDir = opts.workDir ? path.resolve(opts.workDir) : null;
  const fixtureRoot = path.resolve(opts.fixtureRoot || opts.workDir || process.cwd());

  if (!skillName) {
    return { ok: false, code: 'SKILL_NAME_REQUIRED', status: 'denied' };
  }
  if (!workDir) {
    return { ok: false, code: 'WORKDIR_REQUIRED', status: 'denied' };
  }

  let sandbox;
  try {
    sandbox = loadSandboxApi(opts.sandboxApi);
  } catch (err) {
    return { ok: false, code: err.code || 'SANDBOX_UNAVAILABLE', message: err.message, status: 'denied', spawned: false };
  }

  const resolved = resolveAndVerify(registryRoot, skillName, range);
  if (!resolved.ok) {
    return {
      ok: false,
      status: 'denied',
      code: resolved.code,
      skill: skillName,
      spawned: false,
    };
  }

  const decision = opts.decision || allowDecision();
  // Grants never from caller-supplied skill input — decision is constructed here / by PDP.
  if (opts.callerGrants) {
    return {
      ok: false,
      status: 'denied',
      code: 'GRANT_INJECTION_DENIED',
      message: 'grants must not be caller-supplied',
      spawned: false,
    };
  }

  const policyEvent = recordPolicyDecision({
    workDir,
    decision,
    toolName: `skill:${skillName}`,
    state: opts.state || 'validation',
    track: opts.track || 'standard',
    idempotency_key: `policy:skill-invoke:${skillName}:${resolved.digest.slice(0, 16)}`,
    write_audit: true,
  });

  const profileRes = sandbox.resolveSandboxProfile('plugin-untrusted', {
    cwd_root: fixtureRoot,
    timeout_ms: 15000,
  });
  if (!profileRes.ok) {
    return { ok: false, status: 'denied', code: profileRes.code, message: profileRes.message, spawned: false };
  }

  const skillPkg = path.join(registryRoot, 'skills', skillName, resolved.version);
  const skillMd = path.join(skillPkg, 'SKILL.md');
  const manifestPath = path.join(skillPkg, 'manifest.json');
  const probePath = path.join(__dirname, 'skill-invoke-probe.cjs');
  if (!fs.existsSync(probePath)) {
    return { ok: false, status: 'error', code: 'PROBE_MISSING', message: 'skill-invoke-probe.cjs missing', spawned: false };
  }

  const key = crypto
    .createHash('sha256')
    .update(`skill-invoke:${skillName}:${resolved.digest}:${fixtureRoot}`)
    .digest('hex')
    .slice(0, 32);

  let requestedEvent = null;
  try {
    requestedEvent = appendEvent(workDir, {
      type: 'tool.requested',
      payload: {
        tool_id: `skill:${skillName}`,
        tool_version: resolved.version,
        idempotency_key: key,
        policy_decision_ref: policyEvent ? { seq: policyEvent.seq, hash: policyEvent.hash } : null,
        permissions: resolved.manifest.permissions || [],
        side_effects: ['proc.exec:sandbox'],
      },
      idempotency_key: `requested:${key}`,
    });
  } catch (err) {
    return {
      ok: false,
      status: 'error',
      code: err.code || 'JOURNAL_APPEND_FAILED',
      message: err.message,
      spawned: false,
      policy_source_seq: policyEvent ? policyEvent.seq : null,
    };
  }

  const spawnResult = await sandbox.spawnSandboxed(
    profileRes.profile,
    process.execPath,
    [probePath, skillMd, manifestPath, resolved.digest],
    {
      cwd: fixtureRoot,
      decision,
      spawn: opts.spawn,
    }
  );

  const resultPayload = {
    tool_id: `skill:${skillName}`,
    tool_version: resolved.version,
    idempotency_key: key,
    policy_decision_ref: policyEvent ? { seq: policyEvent.seq, hash: policyEvent.hash } : null,
    status: spawnResult.ok ? 'ok' : 'error',
    result: {
      ok: spawnResult.ok === true,
      spawned: spawnResult.spawned === true,
      code: spawnResult.code || null,
      stdout: String(spawnResult.stdout || '').slice(0, 4096),
      stderr: String(spawnResult.stderr || '').slice(0, 4096),
      profile_id: spawnResult.profile_id || profileRes.profile.id,
      digest: resolved.digest,
      version: resolved.version,
    },
  };

  let completedEvent = null;
  try {
    completedEvent = appendEvent(workDir, {
      type: 'tool.completed',
      payload: resultPayload,
      idempotency_key: `completed:${key}`,
    });
  } catch (err) {
    return {
      ok: false,
      status: 'error',
      code: err.code || 'JOURNAL_APPEND_FAILED',
      message: err.message,
      spawned: spawnResult.spawned === true,
      policy_source_seq: policyEvent ? policyEvent.seq : null,
      tool_requested_seq: requestedEvent ? requestedEvent.seq : null,
    };
  }

  // Gate-time digest re-check (write-time install vs invoke-time body).
  const rawNow = fs.readFileSync(skillMd, 'utf8');
  const digCheck = verifySkillDigest(rawNow, resolved.digest);
  if (!digCheck.ok) {
    return {
      ok: false,
      status: 'error',
      code: digCheck.code,
      skill: skillName,
      policy_source_seq: policyEvent.seq,
      tool_requested_seq: requestedEvent.seq,
      tool_completed_seq: completedEvent.seq,
      spawned: spawnResult.spawned === true,
    };
  }

  return {
    ok: spawnResult.ok === true && spawnResult.spawned === true,
    status: spawnResult.ok ? 'ok' : 'error',
    skill: skillName,
    version: resolved.version,
    digest: resolved.digest,
    profile_id: profileRes.profile.id,
    spawned: spawnResult.spawned === true,
    code: spawnResult.ok ? undefined : spawnResult.code,
    message: spawnResult.message,
    stdout: spawnResult.stdout,
    stderr: spawnResult.stderr,
    policy_source_seq: policyEvent.seq,
    tool_requested_seq: requestedEvent.seq,
    tool_completed_seq: completedEvent.seq,
  };
}

/**
 * Cross-project compatibility eval for the AE-029a library on >=2 fixtures.
 * @returns {{ ok: boolean, summary: object }}
 */
async function evaluateCrossProjectCompatibility(opts) {
  const pluginRoot = path.resolve(opts.pluginRoot);
  const fixtures = opts.fixtures;
  if (!Array.isArray(fixtures) || fixtures.length < 2) {
    return { ok: false, code: 'FIXTURES_REQUIRED', message: 'need >=2 fixture roots' };
  }

  const lib = loadFirstPartyLibrary(pluginRoot);
  const rows = [];

  for (const fixture of fixtures) {
    const id = String(fixture.id || '').trim();
    const root = path.resolve(fixture.root);
    if (!id || !root) {
      rows.push({ fixture: id || '(blank)', status: 'fail', reason: 'blank fixture id/root' });
      continue;
    }
    if (!fs.existsSync(root)) {
      rows.push({ fixture: id, status: 'fail', reason: 'fixture root missing' });
      continue;
    }

    const registryRoot = path.join(root, '.agentic-swe', 'skill-registry');
    const workDir = path.join(root, '.worklogs', 'ae-029b-compat');
    fs.rmSync(registryRoot, { recursive: true, force: true });
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.mkdirSync(workDir, { recursive: true });

    const installed = installFirstPartyLibraryIntoRegistry({ pluginRoot, registryRoot });
    if (!installed.ok) {
      rows.push({
        fixture: id,
        status: 'fail',
        reason: `install ${installed.skill || ''}: ${installed.code}`,
      });
      continue;
    }

    for (const entry of lib.skills) {
      const result = await invokeSkillViaRegistry({
        registryRoot,
        skillName: entry.name,
        workDir,
        fixtureRoot: root,
        sandboxApi: opts.sandboxApi,
        decision: allowDecision({ reason: `compat fixture ${id}` }),
        track: 'standard',
        state: 'validation',
      });
      let status = 'pass';
      let reason = null;
      if (!result.ok) {
        if (result.code === 'SANDBOX_UNAVAILABLE') {
          status = 'skip';
          reason = result.message || result.code;
        } else {
          status = 'fail';
          reason = result.code || result.message || 'invoke failed';
        }
      }
      rows.push({
        fixture: id,
        skill: entry.name,
        domain: entry.domain,
        status,
        reason,
        policy_source_seq: result.policy_source_seq ?? null,
        tool_requested_seq: result.tool_requested_seq ?? null,
        tool_completed_seq: result.tool_completed_seq ?? null,
        digest: result.digest || null,
        version: result.version || null,
      });
    }

    // Evidence: journal must expose policy + tool calls with source_seq.
    const chain = readJournal(workDir);
    if (!chain.ok) {
      rows.push({ fixture: id, status: 'fail', reason: `journal integrity ${chain.code || 'FAILED'}` });
    }
  }

  const failed = rows.filter((r) => r.status === 'fail');
  const skipped = rows.filter((r) => r.status === 'skip');
  const passed = rows.filter((r) => r.status === 'pass');
  const summary = {
    version: 1,
    suite_id: 'ae-029b-cross-project-compat',
    generated_at: '2026-11-12T00:00:00.000Z',
    fixtures: fixtures.map((f) => f.id),
    totals: { pass: passed.length, fail: failed.length, skip: skipped.length, rows: rows.length },
    rows,
  };

  if (opts.summaryPath) {
    const out = path.resolve(opts.summaryPath);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
  }

  return { ok: failed.length === 0, summary };
}

module.exports = {
  loadSandboxApi,
  allowDecision,
  installFirstPartyLibraryIntoRegistry,
  invokeSkillViaRegistry,
  evaluateCrossProjectCompatibility,
};
