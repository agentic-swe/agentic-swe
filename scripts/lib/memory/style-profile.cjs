'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { discoverTranscriptSources } = require('./discover-transcripts.cjs');
const { partsToText } = require('./session-ingest.cjs');

const MAX_CONSTRAINTS = 48;

function slugId(prefix, text) {
  const slug = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return slug ? `${prefix}-${slug}` : `${prefix}-${Date.now()}`;
}

function extractBoldGuidelineConstraints(filePath, max = 8) {
  if (!fs.existsSync(filePath)) return [];
  const body = fs.readFileSync(filePath, 'utf8');
  const out = [];
  const seen = new Set();

  function push(title, rest) {
    const t = title.trim().replace(/:$/, '');
    const id = slugId('policy', t);
    if (!t || seen.has(id) || out.length >= max) return;
    seen.add(id);
    out.push({
      id,
      text: `${t} — ${rest.trim().replace(/\*\*/g, '').slice(0, 160)}`,
      provenance: path.basename(filePath),
    });
  }

  const reDash = /^\s*[-*]\s+\*\*([^*]+)\*\*\s+[—–-]\s+(.+)$/gm;
  let m;
  while ((m = reDash.exec(body)) !== null) push(m[1], m[2]);

  const reColon = /^\s*[-*]\s+\*\*([^*]+):\*\*\s+(.+)$/gm;
  while ((m = reColon.exec(body)) !== null) push(m[1], m[2]);

  return out;
}

/**
 * Extract clone-me constraint phrases from free text (sessions, worklogs, plans).
 * @param {string} text
 * @param {string} provenance
 * @param {number} [max]
 */
function extractPhraseConstraints(text, provenance, max = 6) {
  if (!text || !text.trim()) return [];
  const out = [];
  const seen = new Set();
  const patterns = [
    /(?:decision locked with human|decision locked)[:\s—–-]+(.{18,200})/gi,
    /(?:^|\n)\s*(?:decision|lesson|convention|pitfall)\s*[:\-]\s*(.{18,200})/gi,
    /(?:never|do not|must not|only you|ask before|prefer zero)\s+(.{12,160})/gi,
  ];

  function push(raw) {
    const textClean = raw.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
    if (textClean.length < 12) return;
    const id = slugId('phrase', `${provenance}:${textClean.slice(0, 60)}`);
    if (seen.has(id) || out.length >= max) return;
    seen.add(id);
    out.push({ id, text: textClean.slice(0, 180), provenance });
  }

  for (const re of patterns) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(text)) !== null) push(match[1]);
  }
  return out;
}

/**
 * @param {string[]} files
 * @param {{ maxFiles?: number, maxPerFile?: number }} [opts]
 */
function extractFromSessionFiles(files, opts = {}) {
  const maxFiles = opts.maxFiles ?? 24;
  const maxPerFile = opts.maxPerFile ?? 2;
  const out = [];
  for (const abs of files.slice(0, maxFiles)) {
    if (!fs.existsSync(abs)) continue;
    let body = '';
    try {
      body = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const lines = body.split('\n').slice(0, 400);
    const chunks = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const row = JSON.parse(trimmed);
        const text =
          typeof row.text === 'string'
            ? row.text
            : partsToText(row.message?.content || row.content || row.parts || row);
        if (text) chunks.push(text);
      } catch {
        if (trimmed.startsWith('{')) continue;
        chunks.push(trimmed);
      }
    }
    const joined = chunks.join('\n').slice(0, 12000);
    out.push(...extractPhraseConstraints(joined, `session:${path.basename(abs)}`, maxPerFile));
  }
  return out;
}

/**
 * @param {string} worklogsDir
 * @param {{ maxWorklogs?: number }} [opts]
 */
function extractFromWorklogs(worklogsDir, opts = {}) {
  if (!fs.existsSync(worklogsDir)) return [];
  const maxWorklogs = opts.maxWorklogs ?? 8;
  const out = [];
  const dirs = fs
    .readdirSync(worklogsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'goals')
    .map((d) => d.name)
    .slice(0, maxWorklogs);

  for (const id of dirs) {
    const base = path.join(worklogsDir, id);
    for (const name of ['reflection-log.md', 'feasibility.md', 'design.md']) {
      const p = path.join(base, name);
      if (!fs.existsSync(p)) continue;
      const body = fs.readFileSync(p, 'utf8');
      out.push(...extractPhraseConstraints(body, `worklog:${id}/${name}`, 3));
      if (name === 'reflection-log.md') {
        for (const field of ['Root cause', 'Strategy change', 'What failed']) {
          const re = new RegExp(`\\*\\*${field}\\*\\*:\\s*(.+)`, 'gi');
          let match;
          while ((match = re.exec(body)) !== null) {
            out.push({
              id: slugId('reflection', `${id}:${field}:${match[1].slice(0, 40)}`),
              text: `${field}: ${match[1].trim().slice(0, 160)}`,
              provenance: `worklog:${id}/${name}`,
            });
          }
        }
      }
      for (const c of extractBoldGuidelineConstraints(p, 4)) {
        out.push({ ...c, provenance: `worklog:${id}/${name}` });
      }
    }
  }
  return out;
}

/**
 * @param {string} plansDir
 * @param {{ max?: number }} [opts]
 */
function extractFromDocsPlans(plansDir, opts = {}) {
  if (!fs.existsSync(plansDir)) return [];
  const max = opts.max ?? 12;
  const out = [];
  const files = fs.readdirSync(plansDir).filter((f) => f.endsWith('.md')).slice(0, 6);
  for (const f of files) {
    const abs = path.join(plansDir, f);
    const body = fs.readFileSync(abs, 'utf8');
    out.push(...extractPhraseConstraints(body, `docs/plans/${f}`, 4));
    if (/agentic-loops.*later phase|rename.*executed as a later phase/i.test(body)) {
      out.push({
        id: 'plan-agentic-loops-deferred',
        text: 'agentic-loops rename is sequenced after the paradigm ships; do not mix rename with feature work.',
        provenance: `docs/plans/${f}`,
      });
    }
    if (/evolve the paradigm first/i.test(body)) {
      out.push({
        id: 'plan-paradigm-first',
        text: 'Evolve the orchestrator paradigm before rebrand or rename work.',
        provenance: `docs/plans/${f}`,
      });
    }
  }
  return out.slice(0, max);
}

/** @param {string} changelogPath */
function extractFromChangelog(changelogPath) {
  if (!fs.existsSync(changelogPath)) return [];
  const body = fs.readFileSync(changelogPath, 'utf8');
  const out = [];
  if (/removed the.*uat.*line|no separate.*uat.*staging/i.test(body)) {
    out.push({
      id: 'uat-branch-removed',
      text: 'UAT staging branch was deliberately removed; topic branches merge directly to main.',
      provenance: 'CHANGELOG.md',
    });
  }
  if (/catalog-counts|render-catalog-counts/i.test(body)) {
    out.push({
      id: 'catalog-counts-sync',
      text: 'Keep README/CLAUDE/AGENTS catalog count blocks in sync via render-catalog-counts when agents change.',
      provenance: 'CHANGELOG.md',
    });
  }
  return out;
}

/** @param {string} branchWorkflowPath */
function extractFromBranchWorkflow(branchWorkflowPath) {
  if (!fs.existsSync(branchWorkflowPath)) return [];
  const body = fs.readFileSync(branchWorkflowPath, 'utf8');
  const out = [];
  if (/Do not run `git add`/i.test(body)) {
    out.push({
      id: 'ask-before-git-add',
      text: 'Do not run git add until the user confirms what should be staged unless they explicitly asked to commit.',
      provenance: 'docs/branch-workflow.md',
    });
  }
  if (/only `@?suraj/i.test(body) || /only you merge/i.test(body)) {
    out.push({
      id: 'only-owner-merge',
      text: 'Only the repo owner merges to main; open PRs but do not merge without explicit approval.',
      provenance: 'docs/branch-workflow.md',
    });
  }
  return out;
}

/** @param {string} projectRoot @param {number} [max] */
function extractGitThemes(projectRoot, max = 5) {
  try {
    const log = execSync('git log -25 --no-merges --pretty=format:%s', {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const themes = log
      .split('\n')
      .filter((line) => /version|sync|docs|catalog|memory|bench|skill|fleet|descent|fix|test|refactor/i.test(line))
      .slice(0, max);
    return themes.map((subject, i) => ({
      id: slugId('git', subject.slice(0, 50)),
      text: `Recent commit theme: ${subject.slice(0, 120)}`,
      provenance: 'git-history',
    }));
  } catch {
    return [];
  }
}

/**
 * Build compact style profile (clone-me constraints with provenance).
 * @param {{ projectRoot: string, pluginRoot: string, sessionFiles?: string[]|null }} opts
 */
function buildStyleProfile(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const pluginRoot = path.resolve(opts.pluginRoot);
  /** @type {Array<{ id: string, text: string, provenance: string }>} */
  const constraints = [];
  const seen = new Set();
  /** @type {Record<string, number>} */
  const sources = {};

  function noteSource(key, n = 1) {
    sources[key] = (sources[key] || 0) + n;
  }

  function add(c) {
    if (!c?.text || seen.has(c.id) || constraints.length >= MAX_CONSTRAINTS) return;
    seen.add(c.id);
    constraints.push(c);
  }

  function addMany(list, sourceKey) {
    let n = 0;
    for (const c of list) {
      const before = constraints.length;
      add(c);
      if (constraints.length > before) n++;
    }
    if (n) noteSource(sourceKey, n);
  }

  add({
    id: 'docs-drift',
    text: 'Keep CLAUDE.md, AGENTS.md, GEMINI.md, CHANGELOG, and catalog counts in the same change when policy shifts.',
    provenance: 'repo-convention',
  });
  noteSource('repo-convention', 1);
  add({
    id: 'zero-deps',
    text: 'Prefer zero new runtime dependencies unless explicitly approved.',
    provenance: 'plan-phase3-seed',
  });
  noteSource('plan-phase3-seed', 1);
  add({
    id: 'state-authority',
    text: 'state.json and repo artifacts override chat memory and retrieved hints.',
    provenance: 'CLAUDE.md',
  });
  noteSource('CLAUDE.md', 1);
  add({
    id: 'no-competitor-copy',
    text: 'Never copy competitor code or proprietary third-party implementations into this repo.',
    provenance: 'plan-phase3-seed',
  });
  noteSource('plan-phase3-seed', 1);

  for (const rel of ['CLAUDE.md', 'AGENTS.md']) {
    for (const root of new Set([projectRoot, pluginRoot])) {
      for (const c of extractBoldGuidelineConstraints(path.join(root, rel))) {
        add(c);
        noteSource(rel, 1);
      }
    }
  }

  addMany(extractFromChangelog(path.join(pluginRoot, 'CHANGELOG.md')), 'CHANGELOG.md');
  addMany(extractFromBranchWorkflow(path.join(pluginRoot, 'docs/branch-workflow.md')), 'docs/branch-workflow.md');
  addMany(extractFromDocsPlans(path.join(pluginRoot, 'docs/plans')), 'docs/plans');
  addMany(extractFromWorklogs(path.join(projectRoot, '.worklogs')), 'worklogs');
  addMany(extractGitThemes(projectRoot), 'git-history');

  let sessionFiles = opts.sessionFiles;
  if (sessionFiles == null) {
    sessionFiles = discoverTranscriptSources(projectRoot).files;
  }
  if (sessionFiles?.length) {
    addMany(extractFromSessionFiles(sessionFiles), 'sessions');
  }

  return {
    version: '1',
    generated_at: new Date().toISOString(),
    sources,
    constraints,
  };
}

/**
 * @param {string} projectRoot
 * @param {ReturnType<typeof buildStyleProfile>} profile
 */
function writeStyleProfile(projectRoot, profile) {
  const dir = path.join(projectRoot, '.agentic-swe');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'style-profile.json'), JSON.stringify(profile, null, 2));
}

module.exports = {
  buildStyleProfile,
  writeStyleProfile,
  extractBoldGuidelineConstraints,
  extractPhraseConstraints,
  extractFromSessionFiles,
  extractFromWorklogs,
  extractFromDocsPlans,
  extractFromChangelog,
  extractFromBranchWorkflow,
  extractGitThemes,
};
