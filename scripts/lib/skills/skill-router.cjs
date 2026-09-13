'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { extractFrontmatter } = require('../catalog/parse-frontmatter.cjs');
const { parseMetadataMap } = require('./golden-eval.cjs');
const { rankLexical } = require('../catalog/lexical-rank.cjs');
const { listSkills } = require('./project-skills.cjs');

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
 * Rank skills for a query; flag unevaluated for autonomous use.
 * Memory graph + evaluated procedures can boost ranks when projectRoot is set.
 * @param {{ pluginRoot: string, query: string, k?: number, projectRoot?: string, memoryBoosts?: Record<string, number> }} opts
 */
function routeSkills(opts) {
  const pluginRoot = path.resolve(opts.pluginRoot);
  const projectRoot = opts.projectRoot ? path.resolve(opts.projectRoot) : null;
  const k = Math.min(20, Math.max(1, opts.k || 5));
  const skills = listSkillsMerged(pluginRoot, projectRoot);

  const blobs = skills.map((s) => ({
    name: s.name,
    blob: `${s.name} ${s.description} ${s.kind}`,
    skill: s,
  }));

  const ranked = rankLexical(
    opts.query,
    blobs.map((b) => ({ id: b.name, text: b.blob }))
  );

  const boosts = opts.memoryBoosts || {};
  const combined = ranked.map((r) => ({
    id: r.id,
    score: r.score + (boosts[r.id] || 0),
    memory_boost: boosts[r.id] || 0,
  }));
  combined.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.id.localeCompare(b.id);
  });

  const results = combined.slice(0, k).map((r) => {
    const skill = skills.find((s) => s.name === r.id);
    const autonomousAllowed = skill?.eval_status === 'evaluated';
    return {
      name: r.id,
      score: r.score,
      memory_boost: r.memory_boost,
      kind: skill?.kind,
      eval_status: skill?.eval_status,
      eval_ref: skill?.eval_ref,
      tier: skill?.tier,
      autonomous_allowed: autonomousAllowed,
      flag: autonomousAllowed ? null : 'unevaluated — manual invocation only',
    };
  });

  const unevaluatedInTopK = results.filter((row) => !row.autonomous_allowed).length;
  return { query: opts.query, results, unevaluated_in_top_k: unevaluatedInTopK };
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
};
