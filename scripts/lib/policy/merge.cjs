'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Load a policy file, returning null if not found.
 */
function loadPolicy(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Merge policies with precedence: org > repo > pack default.
 * Arrays are concatenated (deduped by key fields).
 * Objects are shallow-merged (higher precedence wins on conflict).
 */
function mergePolicies(packDefault, repoPolicy, orgPolicy) {
  const result = { ...packDefault };

  for (const policy of [repoPolicy, orgPolicy].filter(Boolean)) {
    if (policy.track_rules) {
      result.track_rules = [...(result.track_rules || []), ...policy.track_rules];
    }
    if (policy.mandatory_subagents) {
      result.mandatory_subagents = [...(result.mandatory_subagents || []), ...policy.mandatory_subagents];
    }
    if (policy.banned_tools) {
      result.banned_tools = [...(result.banned_tools || []), ...policy.banned_tools];
    }
    if (policy.banned_commands) {
      result.banned_commands = [...(result.banned_commands || []), ...policy.banned_commands];
    }
    if (policy.protected_paths) {
      result.protected_paths = [...(result.protected_paths || []), ...policy.protected_paths];
    }
    if (policy.phase_tool_allowlist) {
      // Most restrictive wins: a state restricted at two levels allows only tools in both lists.
      const merged = { ...(result.phase_tool_allowlist || {}) };
      for (const [state, tools] of Object.entries(policy.phase_tool_allowlist)) {
        merged[state] = Array.isArray(merged[state]) ? merged[state].filter((t) => tools.includes(t)) : [...tools];
      }
      result.phase_tool_allowlist = merged;
    }
    if (policy.required_artifacts) {
      result.required_artifacts = result.required_artifacts || {};
      for (const [state, arts] of Object.entries(policy.required_artifacts)) {
        result.required_artifacts[state] = [
          ...(result.required_artifacts[state] || []),
          ...arts,
        ];
      }
    }
    if (policy.budget_overrides) {
      result.budget_overrides = { ...(result.budget_overrides || {}), ...policy.budget_overrides };
    }
  }

  return result;
}

/**
 * Resolve the effective policy for a repository.
 * Looks for:
 *   1. Pack default: config/default-policy.json
 *   2. Repo policy: .agentic-swe/policy.json
 *   3. Org policy: AGENTIC_SWE_POLICY env var
 */
function resolvePolicy(repoRoot, packRoot) {
  const packConfig = packRoot ? path.join(packRoot, 'config') : path.join(__dirname, '..', '..', '..', 'config');
  const packDefault = loadPolicy(path.join(packConfig, 'default-policy.json')) || {};
  const repoPolicy = loadPolicy(path.join(repoRoot, '.agentic-swe', 'policy.json'));
  const orgPolicyPath = process.env.AGENTIC_SWE_POLICY;
  const orgPolicy = orgPolicyPath ? loadPolicy(orgPolicyPath) : null;

  return mergePolicies(packDefault, repoPolicy, orgPolicy);
}

function readPolicySource(label, filePath, errors) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    errors.push(`${label} policy ${filePath} is unreadable: ${e.message}`);
    return null;
  }
  const { validatePolicy } = require('./validate.cjs');
  const v = validatePolicy(parsed);
  if (!v.ok) {
    errors.push(`${label} policy ${filePath} is invalid: ${v.errors.join('; ')}`);
    return null;
  }
  return parsed;
}

/**
 * Like resolvePolicy, but reports every unreadable or schema-invalid source instead of
 * silently dropping it. The merged result is validated too.
 * @returns {{ policy: object, errors: string[] }}
 */
function resolvePolicyChecked(repoRoot, packRoot) {
  const errors = [];
  const packConfig = packRoot ? path.join(packRoot, 'config') : path.join(__dirname, '..', '..', '..', 'config');
  const packFile = path.join(packConfig, 'default-policy.json');
  if (!fs.existsSync(packFile)) errors.push(`pack default policy ${packFile} is missing`);
  const packDefault = readPolicySource('pack', packFile, errors) || {};
  const repoPolicy = readPolicySource('repo', path.join(repoRoot, '.agentic-swe', 'policy.json'), errors);
  const orgPath = process.env.AGENTIC_SWE_POLICY;
  if (orgPath && !fs.existsSync(orgPath)) errors.push(`org policy ${orgPath} (AGENTIC_SWE_POLICY) does not exist`);
  const orgPolicy = readPolicySource('org', orgPath, errors);
  const policy = mergePolicies(packDefault, repoPolicy, orgPolicy);
  const { validatePolicy } = require('./validate.cjs');
  const merged = validatePolicy(policy);
  if (!merged.ok) errors.push(`merged policy is invalid: ${merged.errors.join('; ')}`);
  return { policy, errors };
}

/**
 * Check whether a file path triggers any track rule.
 * Returns the highest minimum_track or null.
 */
function checkTrackRules(filePaths, policy) {
  const trackOrder = { lean: 0, standard: 1, rigorous: 2 };
  let maxTrack = null;
  let maxOrder = -1;

  for (const rule of (policy.track_rules || [])) {
    const { minimatch } = require('minimatch');
    for (const fp of filePaths) {
      if (typeof rule.pattern === 'string' && rule.pattern.length > 0 && rule.pattern.length <= 512 && minimatch(fp, rule.pattern)) {
        const order = trackOrder[rule.minimum_track] || 0;
        if (order > maxOrder) {
          maxOrder = order;
          maxTrack = rule.minimum_track;
        }
      }
    }
  }

  return maxTrack;
}

module.exports = { loadPolicy, mergePolicies, resolvePolicy, resolvePolicyChecked, checkTrackRules };
