'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { extractFrontmatter } = require('../catalog/parse-frontmatter.cjs');
const { parseMetadataMap } = require('./golden-eval.cjs');
const { rankLexical } = require('../catalog/lexical-rank.cjs');
const { listSkills } = require('./project-skills.cjs');
const { checkSkillEvalGate } = require('./eval-gate.cjs');

/** Stable score-breakdown keys for explainable routing (AE-026a). */
const SCORE_BREAKDOWN_KEYS = Object.freeze([
  'lexical',
  'memory_boost',
  'mention_boost',
  'ritual_boost',
  'eval_gate',
  'capability',
  'compat',
  'risk',
  'cost',
]);

/**
 * List all skills with metadata (pack + optional project `.agentic-swe/skills`).
 * @param {string} pluginRoot
 * @param {string} [projectRoot]
 */
function listSkillsMerged(pluginRoot, projectRoot) {
  return listSkills(pluginRoot, projectRoot);
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function skillMentionCount(haystack, skillName) {
  const n = String(skillName).toLowerCase();
  if (n.length < 6 && !n.includes('-')) return 0;
  const re = new RegExp(`(?:^|[^a-z0-9])${escapeRe(n)}(?:$|[^a-z0-9])`, 'gi');
  const m = String(haystack || '').match(re);
  return m ? Math.min(5, m.length) : 0;
}

function procedureNpmRunSkillBoost(haystack, skillName) {
  const n = String(skillName).toLowerCase();
  if (n.length < 3 || !/^[a-z][a-z0-9-]*$/.test(n)) return 0;
  const re = new RegExp(`\\bnpm run ${escapeRe(n)}\\b`, 'i');
  return re.test(String(haystack || '')) ? 2.5 : 0;
}

function applySkillBoosts(boosts, skillNames, haystack) {
  for (const name of skillNames || []) {
    const mention = skillMentionCount(haystack, name);
    const ritual = procedureNpmRunSkillBoost(haystack, name);
    const add = mention * 1.5 + ritual;
    if (add > 0) boosts[name] = Math.max(boosts[name] || 0, add);
  }
  return boosts;
}

function extractBoostTokens(q) {
  return String(q || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length >= 3)
    .slice(0, 12);
}

function collectMemoryHaystack(db, query) {
  const tokens = extractBoostTokens(query);
  const parts = [];
  try {
    if (tokens.length) {
      const sql =
        'SELECT body FROM chunks WHERE ' +
        tokens.map(() => 'lower(body) LIKE ?').join(' OR ') +
        ' LIMIT 40';
      const stmt = db.prepare(sql);
      stmt.bind(tokens.map((t) => `%${t}%`));
      while (stmt.step()) {
        const o = stmt.getAsObject();
        if (o.body) parts.push(String(o.body).slice(0, 2000));
      }
      stmt.free();
    } else {
      const stmt = db.prepare('SELECT body FROM chunks LIMIT 24');
      while (stmt.step()) {
        const o = stmt.getAsObject();
        if (o.body) parts.push(String(o.body).slice(0, 2000));
      }
      stmt.free();
    }
  } catch {
    /* no chunks */
  }
  try {
    const { queryWorkIdChunksDb, queryFleetSubmissionChunksDb } = require('../memory/graph-query.cjs');
    for (const wid of ['personal', 'team']) {
      for (const row of queryWorkIdChunksDb(db, wid, 8)) {
        if (row.body) parts.push(String(row.body));
      }
    }
    for (const row of queryFleetSubmissionChunksDb(db, 6)) {
      if (row.body) parts.push(String(row.body));
    }
  } catch {
    /* optional */
  }
  return parts.join('\n');
}

function muscleHaystack(storeRoot) {
  try {
    const { loadStore } = require('../descent/promotion.cjs');
    const data = loadStore(storeRoot);
    return (data.procedures || [])
      .filter((p) => p.eval_status === 'evaluated')
      .slice(0, 40)
      .map((p) => {
        const paths = (p.procedure?.actions || []).map((a) => a.path).filter(Boolean).join(' ');
        const cmd = p.procedure?.verify?.[0]?.command || '';
        const src = p.procedure?._meta?.source || '';
        return `${src} ${paths} ${cmd}`;
      })
      .join('\n');
  } catch {
    return '';
  }
}

/**
 * Boost lexical skill ranks from project memory graph + evaluated procedures.
 * @param {{ projectRoot: string, pluginRoot: string, query: string, skillNames: string[] }} opts
 * @returns {Record<string, number>}
 */
function computeMemorySkillBoosts(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const pluginRoot = path.resolve(opts.pluginRoot);
  const storeRoot = fs.existsSync(path.join(projectRoot, '.agentic-swe', 'procedures.json'))
    ? projectRoot
    : pluginRoot;
  const haystack = muscleHaystack(storeRoot);
  return applySkillBoosts({}, opts.skillNames || [], haystack);
}

async function computeMemorySkillBoostsAsync(opts) {
  const boosts = {};
  const projectRoot = path.resolve(opts.projectRoot);
  const pluginRoot = path.resolve(opts.pluginRoot);
  const storeRoot = fs.existsSync(path.join(projectRoot, '.agentic-swe', 'procedures.json'))
    ? projectRoot
    : pluginRoot;
  let haystack = muscleHaystack(storeRoot);
  try {
    const { loadMergedMemoryConfig, sqlitePathForProject } = require('../memory/config.cjs');
    const { openOrCreateDatabase, closeDatabase } = require('../memory/graph-store.cjs');
    const roots = projectRoot === pluginRoot ? [projectRoot] : [projectRoot, pluginRoot];
    for (const root of roots) {
      const merged = loadMergedMemoryConfig(pluginRoot, root);
      const sqlitePath = sqlitePathForProject(merged, root);
      if (!fs.existsSync(sqlitePath)) continue;
      const { db } = await openOrCreateDatabase(sqlitePath);
      try {
        if (root === pluginRoot && root !== projectRoot) {
          const { queryFleetSubmissionChunksDb } = require('../memory/graph-query.cjs');
          for (const row of queryFleetSubmissionChunksDb(db, 6)) {
            if (row.body) haystack = `${haystack}\n${String(row.body)}`;
          }
        } else {
          haystack = `${haystack}\n${collectMemoryHaystack(db, opts.query)}`;
        }
      } finally {
        closeDatabase(db);
      }
    }
  } catch {
    /* muscle-only */
  }
  return applySkillBoosts(boosts, opts.skillNames || [], haystack);
}

/**
 * Infer required capability tokens from the query (offline, no network).
 * @param {string} query
 * @returns {string[]}
 */
function inferQueryCapabilities(query) {
  const q = String(query || '').toLowerCase();
  const caps = [];
  if (/\b(security|vuln|cve|authn|authz)\b/.test(q)) caps.push('security');
  if (/\b(test|jest|coverage|qa)\b/.test(q)) caps.push('testing');
  if (/\b(review|pr|diff)\b/.test(q)) caps.push('review');
  if (/\b(doc|readme|writeup)\b/.test(q)) caps.push('docs');
  if (/\b(ci|cd|pipeline|deploy)\b/.test(q)) caps.push('cicd');
  if (/\b(architect|design|api)\b/.test(q)) caps.push('architecture');
  if (/\b(budget|transition|work-engine|feasibility)\b/.test(q)) caps.push('pipeline');
  return caps;
}

function skillCapabilityTokens(skill) {
  const text = `${skill.name} ${skill.description} ${skill.kind}`.toLowerCase();
  const caps = [];
  if (/security|vuln|cve|auth/.test(text)) caps.push('security');
  if (/test|qa|coverage|jest/.test(text)) caps.push('testing');
  if (/review|code-review/.test(text)) caps.push('review');
  if (/doc|writer|readme/.test(text)) caps.push('docs');
  if (/devops|ci|cd|build|deploy/.test(text)) caps.push('cicd');
  if (/architect|api-design|design/.test(text)) caps.push('architecture');
  if (/check|budget|feasibility|work|phase|command/.test(text)) caps.push('pipeline');
  return caps;
}

/**
 * Rank skills for a query with explainable score breakdown + reject reasons (AE-026a).
 * Memory graph + evaluated procedures can boost ranks when projectRoot is set.
 * Never performs non-loopback network I/O; paid embeddings stay off (PD-9).
 * @param {{
 *   pluginRoot: string,
 *   query: string,
 *   k?: number,
 *   projectRoot?: string,
 *   memoryBoosts?: Record<string, number>,
 *   autonomous?: boolean,
 *   transport?: { fetch?: Function } | null,
 * }} opts
 */
function routeSkills(opts) {
  // Network default-deny: callers may inject a transport spy; we never call fetch ourselves.
  if (opts.transport && typeof opts.transport.fetch === 'function' && opts.forceNetwork) {
    throw new Error('skill-router refuses network fetch (PD-9 / AE-026a)');
  }

  const pluginRoot = path.resolve(opts.pluginRoot);
  const projectRoot = opts.projectRoot ? path.resolve(opts.projectRoot) : null;
  const k = Math.min(20, Math.max(1, opts.k || 5));
  const autonomous = opts.autonomous === true;
  const skills = listSkillsMerged(pluginRoot, projectRoot);
  const queryCaps = inferQueryCapabilities(opts.query);

  const blobs = skills.map((s) => ({
    name: s.name,
    blob: `${s.name} ${s.description} ${s.kind}`,
    skill: s,
  }));

  const ranked = rankLexical(
    opts.query,
    blobs.map((b) => ({ id: b.name, text: b.blob }))
  );
  const lexicalById = new Map(ranked.map((r) => [r.id, r.score]));

  const boosts = opts.memoryBoosts || {};
  const haystack = String(opts.query || '');
  const rejected = [];
  const scored = [];

  for (const skill of skills) {
    const lexical = lexicalById.get(skill.name) || 0;
    const memory_boost = boosts[skill.name] || 0;
    const mention_boost = skillMentionCount(haystack, skill.name) * 1.5;
    const ritual_boost = procedureNpmRunSkillBoost(haystack, skill.name);
    const skillCaps = skillCapabilityTokens(skill);
    const capabilityHit =
      queryCaps.length === 0 ? 1 : queryCaps.some((c) => skillCaps.includes(c)) ? 1 : 0;
    const compat = 1; // pack-local skills assumed compatible unless marked otherwise
    const risk = skill.eval_status === 'evaluated' ? 0 : 0.1;
    const cost = 0; // PD-9: fixture/local only

    const gate = checkSkillEvalGate({
      pluginRoot,
      projectRoot: projectRoot || undefined,
      skillName: skill.name,
      autonomous: true,
    });
    const eval_gate = gate.allowed ? 1 : 0;

    const breakdown = {
      lexical,
      memory_boost,
      mention_boost,
      ritual_boost,
      eval_gate,
      capability: capabilityHit,
      compat,
      risk,
      cost,
    };
    // Stable key order / presence for consumers.
    for (const key of SCORE_BREAKDOWN_KEYS) {
      if (breakdown[key] == null) breakdown[key] = 0;
    }

    const score =
      lexical + memory_boost + mention_boost + ritual_boost + capabilityHit * 0.5 - risk;

    const rejectReasons = [];
    if (queryCaps.length && capabilityHit === 0 && lexical < 0.05) {
      rejectReasons.push('CAPABILITY_MISMATCH');
    }
    if (!gate.allowed) {
      rejectReasons.push('EVAL_GATE');
    }
    if (compat < 1) rejectReasons.push('COMPAT');

    if (rejectReasons.length && (autonomous || capabilityHit === 0 && lexical < 0.05)) {
      // Always record gate rejects for explainability when score is negligible or autonomous.
      if (lexical < 0.05 || !gate.allowed) {
        rejected.push({ name: skill.name, reasons: rejectReasons, score_breakdown: breakdown });
        continue;
      }
    }

    const autonomousAllowed = gate.allowed === true && skill.eval_status === 'evaluated';
    // lint_passed must never be auto-selected
    if (skill.eval_status === 'lint_passed') {
      assertNeverAutoSelected(skill.name);
    }

    scored.push({
      name: skill.name,
      score,
      memory_boost,
      kind: skill.kind,
      eval_status: skill.eval_status,
      eval_ref: skill.eval_ref,
      tier: skill.tier,
      autonomous_allowed: autonomousAllowed,
      flag: autonomousAllowed
        ? null
        : `${skill.eval_status === 'lint_passed' ? 'lint_passed' : skill.eval_status || 'unevaluated'} — manual invocation only`,
      score_breakdown: breakdown,
    });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.name.localeCompare(b.name);
  });

  let results = scored.slice(0, k);
  if (autonomous) {
    results = results.filter((row) => row.autonomous_allowed);
    for (const row of scored.slice(0, k)) {
      if (!row.autonomous_allowed && row.eval_status === 'lint_passed') {
        rejected.push({
          name: row.name,
          reasons: ['EVAL_GATE'],
          score_breakdown: row.score_breakdown,
        });
      }
    }
  }

  const unevaluatedInTopK = results.filter((row) => !row.autonomous_allowed).length;
  return {
    query: opts.query,
    results,
    rejected,
    score_breakdown_keys: [...SCORE_BREAKDOWN_KEYS],
    unevaluated_in_top_k: unevaluatedInTopK,
  };
}

function assertNeverAutoSelected(name) {
  // Documented invariant helper — lint_passed rows set autonomous_allowed false above.
  void name;
}

async function routeSkillsWithMemory(opts) {
  const pluginRoot = path.resolve(opts.pluginRoot);
  const projectRoot = path.resolve(opts.projectRoot || pluginRoot);
  const skills = listSkillsMerged(pluginRoot, projectRoot);
  const memoryBoosts = await computeMemorySkillBoostsAsync({
    projectRoot,
    pluginRoot,
    query: opts.query,
    skillNames: skills.map((s) => s.name),
  });
  return routeSkills({ ...opts, projectRoot, memoryBoosts });
}

module.exports = {
  listSkills: listSkillsMerged,
  routeSkills,
  routeSkillsWithMemory,
  skillMentionCount,
  procedureNpmRunSkillBoost,
  applySkillBoosts,
  computeMemorySkillBoosts,
  computeMemorySkillBoostsAsync,
  SCORE_BREAKDOWN_KEYS,
  inferQueryCapabilities,
};
