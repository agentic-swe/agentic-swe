'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { openOrCreateDatabase, persistDatabase, closeDatabase, ensureChunksSchema } = require('./graph-store.cjs');
const { loadMergedMemoryConfig, sqlitePathForProject } = require('./config.cjs');
const { sqlitePathForScope, personalRoot } = require('./scopes.cjs');
const { spawnSync } = require('node:child_process');
const { upsertTypedNodes, redactSecrets } = require('./session-capture.cjs');
const { makeChunkId } = require('./chunk-split.cjs');
const { parseGitLogNameOnly } = require('./git-log-parse.cjs');
const { EVENTS_DIR } = require('../sync/git-sync.cjs');
const { buildStyleProfile, writeStyleProfile } = require('./style-profile.cjs');

function insertScopedChunk(db, opts) {
  const sha = crypto.createHash('sha256').update(opts.body).digest('hex');
  const chunkId = makeChunkId(opts.path, opts.start || 1, opts.end || 1, opts.body);
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO chunks (chunk_id, path, work_id, start_line, end_line, content_sha256, body)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  stmt.run([chunkId, opts.path, opts.workId, opts.start || 1, opts.end || 1, sha, opts.body]);
  stmt.free();
  return chunkId;
}

/**
 * Ingest local team sync events into the project memory graph.
 * @param {{ projectRoot: string, pluginRoot: string }} opts
 */
async function ingestTeamEvents(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const pluginRoot = path.resolve(opts.pluginRoot);
  const merged = loadMergedMemoryConfig(pluginRoot, projectRoot);
  const sqlitePath = sqlitePathForProject(merged, projectRoot);
  const eventsDir = path.join(projectRoot, EVENTS_DIR);
  if (!fs.existsSync(eventsDir)) {
    return { ok: true, events: 0, sqlitePath };
  }

  const files = fs.readdirSync(eventsDir).filter((f) => f.endsWith('.json'));
  const { db } = await openOrCreateDatabase(sqlitePath);
  let events = 0;
  try {
    ensureChunksSchema(db);
    const nodes = [];
    for (const f of files) {
      const abs = path.join(eventsDir, f);
      let ev;
      try {
        ev = JSON.parse(fs.readFileSync(abs, 'utf8'));
      } catch {
        continue;
      }
      const label = String(ev.label || ev.kind || f);
      const body = JSON.stringify({ kind: ev.kind, label, ts: ev.ts, scope: ev.scope || 'team' });
      insertScopedChunk(db, {
        path: `.agentic-swe/sync/events/${f}`,
        workId: 'team',
        body: `${label}\n${body}`,
      });
      nodes.push({
        id: `team:${ev.id || f}`,
        kind: 'team-event',
        label: label.slice(0, 120),
        body,
      });
      events++;
    }
    if (nodes.length) upsertTypedNodes(db, nodes);
    persistDatabase(db, sqlitePath);
  } finally {
    closeDatabase(db);
  }
  return { ok: true, events, sqlitePath };
}

/**
 * Distill personal style profile into ~/.agentic-swe/memory.sqlite.
 * @param {{ projectRoot: string, pluginRoot: string }} opts
 */
async function ingestPersonalProfile(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const pluginRoot = path.resolve(opts.pluginRoot);
  const profile = buildStyleProfile({ projectRoot, pluginRoot });
  writeStyleProfile(projectRoot, profile);

  const sqlitePath = sqlitePathForScope('personal', { pluginRoot, projectRoot });
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
  const { db } = await openOrCreateDatabase(sqlitePath);
  try {
    ensureChunksSchema(db);
    const body = profile.constraints.map((c) => `${c.id}: ${c.text} (${c.provenance})`).join('\n');
    insertScopedChunk(db, {
      path: 'personal/style-profile.md',
      workId: 'personal',
      body: body || 'personal style profile',
    });
    upsertTypedNodes(db, [
      {
        id: 'personal:style-profile',
        kind: 'personal',
        label: 'style profile',
        body,
      },
    ]);
    persistDatabase(db, sqlitePath);
  } finally {
    closeDatabase(db);
  }
  return {
    ok: true,
    constraints: profile.constraints.length,
    sqlitePath,
    personal_root: personalRoot(),
  };
}

const WORKLOG_MD = [
  'implementation.md',
  'validation-results.md',
  'design.md',
  'feasibility.md',
  'progress.md',
  'self-review.md',
  'descent-replay.md',
  'context-pack.json',
];

/**
 * Ingest recent git history into project memory as work_id=team (how this repo is actually changed).
 * @param {{ projectRoot: string, pluginRoot: string, maxCommits?: number }} opts
 */
async function ingestGitTeamHistory(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const pluginRoot = path.resolve(opts.pluginRoot);
  const maxCommits = opts.maxCommits || 40;
  const merged = loadMergedMemoryConfig(pluginRoot, projectRoot);
  const sqlitePath = sqlitePathForProject(merged, projectRoot);
  if (!fs.existsSync(path.join(projectRoot, '.git'))) {
    return { ok: true, commits: 0, sqlitePath, reason: 'not a git repository' };
  }

  const r = spawnSync(
    'git',
    ['-C', projectRoot, 'log', `-n${maxCommits}`, '--no-merges', '--pretty=format:%H%x09%an%x09%s', '--name-only'],
    { encoding: 'utf8', timeout: 20000 }
  );
  if (r.status !== 0) {
    return { ok: true, commits: 0, sqlitePath, reason: (r.stderr || 'git log failed').slice(0, 200) };
  }

  const commits = parseGitLogNameOnly(r.stdout, maxCommits);
  const { db } = await openOrCreateDatabase(sqlitePath);
  try {
    ensureChunksSchema(db);
    const nodes = [];
    for (const c of commits) {
      const files = (c.files || []).filter((f) => f && !f.includes('\0')).slice(0, 24);
      const raw = `commit ${c.hash}\nauthor ${c.author}\n${c.subject}\n${files.join('\n')}`;
      const body = redactSecrets(raw).redacted.slice(0, 4000);
      insertScopedChunk(db, {
        path: `.agentic-swe/sync/git/${c.hash.slice(0, 12)}.md`,
        workId: 'team',
        body,
      });
      nodes.push({
        id: `git:${c.hash}`,
        kind: 'git-commit',
        label: String(c.subject || c.hash).slice(0, 120),
        body: body.slice(0, 2000),
      });
    }
    if (nodes.length) upsertTypedNodes(db, nodes);
    persistDatabase(db, sqlitePath);
  } finally {
    closeDatabase(db);
  }
  return { ok: true, commits: commits.length, sqlitePath };
}

/**
 * Distill skip-LLM pack replay artifacts (any work item, including dogfood) into the graph.
 * @param {{ projectRoot: string, pluginRoot: string }} opts
 */
async function ingestMuscleReplayWorklogs(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const pluginRoot = path.resolve(opts.pluginRoot);
  const worklogsRoot = path.join(projectRoot, '.worklogs');
  const merged = loadMergedMemoryConfig(pluginRoot, projectRoot);
  const sqlitePath = sqlitePathForProject(merged, projectRoot);
  if (!fs.existsSync(worklogsRoot)) {
    return { ok: true, work_items: 0, chunks: 0, sqlitePath };
  }

  const { db } = await openOrCreateDatabase(sqlitePath);
  let workItems = 0;
  let chunks = 0;
  try {
    ensureChunksSchema(db);
    const nodes = [];
    for (const name of fs.readdirSync(worklogsRoot)) {
      const dir = path.join(worklogsRoot, name);
      const replayPath = path.join(dir, 'descent-replay.md');
      const packPath = path.join(dir, 'context-pack.json');
      if (!fs.existsSync(replayPath) && !fs.existsSync(packPath)) continue;
      workItems++;
      const parts = [`work_id=${name} muscle replay`];
      if (fs.existsSync(replayPath)) {
        parts.push(`## descent-replay.md\n${fs.readFileSync(replayPath, 'utf8').slice(0, 4000)}`);
      }
      if (fs.existsSync(packPath)) {
        try {
          const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
          const mm = (pack.muscle_memory || []).slice(0, 8).map((m) => `${m.tier} ${m.command}`).join('\n');
          parts.push(`## context-pack muscle_memory\n${mm || '(none)'}`);
        } catch {
          /* ignore */
        }
      }
      const body = redactSecrets(parts.join('\n\n')).redacted.slice(0, 12000);
      insertScopedChunk(db, {
        path: `.worklogs/${name}/muscle-replay.md`,
        workId: name,
        body,
      });
      chunks++;
      nodes.push({
        id: `muscle-replay:${name}`,
        kind: 'muscle-replay',
        label: `pack replay ${name}`.slice(0, 120),
        body: body.slice(0, 2000),
      });
    }
    if (nodes.length) upsertTypedNodes(db, nodes);
    persistDatabase(db, sqlitePath);
  } finally {
    closeDatabase(db);
  }
  return { ok: true, work_items: workItems, chunks, sqlitePath };
}

/**
 * Distill organic (non-dogfood) .worklogs into the project memory graph.
 * @param {{ projectRoot: string, pluginRoot: string }} opts
 */
async function ingestOrganicWorklogs(opts) {
  const { isDogfoodLiveWorkItem, isOrganicPipelineWorkItem } = require('../bench/production-tier-totals.cjs');
  const projectRoot = path.resolve(opts.projectRoot);
  const pluginRoot = path.resolve(opts.pluginRoot);
  const worklogsRoot = path.join(projectRoot, '.worklogs');
  const merged = loadMergedMemoryConfig(pluginRoot, projectRoot);
  const sqlitePath = sqlitePathForProject(merged, projectRoot);
  if (!fs.existsSync(worklogsRoot)) {
    return { ok: true, work_items: 0, chunks: 0, sqlitePath };
  }

  const { db } = await openOrCreateDatabase(sqlitePath);
  let workItems = 0;
  let chunks = 0;
  try {
    ensureChunksSchema(db);
    const nodes = [];
    for (const name of fs.readdirSync(worklogsRoot)) {
      const dir = path.join(worklogsRoot, name);
      const statePath = path.join(dir, 'state.json');
      if (!fs.existsSync(statePath)) continue;
      let state;
      try {
        state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      } catch {
        continue;
      }
      if (isDogfoodLiveWorkItem(name, state) || !isOrganicPipelineWorkItem(name, state)) continue;
      workItems++;
      const parts = [`work_id=${name} state=${state.current_state} task=${String(state.task || '').slice(0, 400)}`];
      for (const md of WORKLOG_MD) {
        const p = path.join(dir, md);
        if (!fs.existsSync(p)) continue;
        parts.push(`## ${md}\n${fs.readFileSync(p, 'utf8').slice(0, 4000)}`);
      }
      const body = parts.join('\n\n').slice(0, 12000);
      insertScopedChunk(db, {
        path: `.worklogs/${name}/organic-distill.md`,
        workId: name,
        body,
      });
      chunks++;
      nodes.push({
        id: `worklog:${name}`,
        kind: 'work-item',
        label: String(state.task || name).slice(0, 120),
        body: body.slice(0, 2000),
      });
    }
    if (nodes.length) upsertTypedNodes(db, nodes);
    persistDatabase(db, sqlitePath);
  } finally {
    closeDatabase(db);
  }
  return { ok: true, work_items: workItems, chunks, sqlitePath };
}

/**
 * Index project-local `.agentic-swe/skills` into the team memory graph for routing boosts.
 * @param {{ projectRoot: string, pluginRoot: string }} opts
 */
async function ingestProjectSkills(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const pluginRoot = path.resolve(opts.pluginRoot);
  const { listSkills } = require('../skills/project-skills.cjs');
  const projectOnly = listSkills(pluginRoot, projectRoot).filter((s) => s.origin === 'project');
  if (!projectOnly.length) {
    return { ok: true, skills: 0, chunks: 0 };
  }

  const merged = loadMergedMemoryConfig(pluginRoot, projectRoot);
  const sqlitePath = sqlitePathForProject(merged, projectRoot);
  const { db } = await openOrCreateDatabase(sqlitePath);
  let chunks = 0;
  try {
    ensureChunksSchema(db);
    const nodes = [];
    for (const s of projectOnly) {
      const body = `project skill ${s.name} [${s.eval_status}]: ${s.description}`;
      insertScopedChunk(db, {
        path: `.agentic-swe/skills/${s.name}/SKILL.md`,
        workId: 'team',
        body,
      });
      chunks++;
      nodes.push({
        id: `project-skill:${s.name}`,
        kind: 'project-skill',
        label: s.name,
        body: body.slice(0, 2000),
      });
    }
    if (nodes.length) upsertTypedNodes(db, nodes);
    persistDatabase(db, sqlitePath);
  } finally {
    closeDatabase(db);
  }
  return { ok: true, skills: projectOnly.length, chunks, sqlitePath };
}

module.exports = {
  ingestTeamEvents,
  ingestPersonalProfile,
  ingestOrganicWorklogs,
  ingestGitTeamHistory,
  ingestMuscleReplayWorklogs,
  ingestProjectSkills,
  parseGitLogNameOnly,
  insertScopedChunk,
};
