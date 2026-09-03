'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

function extractBoldGuidelineConstraints(filePath, max = 8) {
  if (!fs.existsSync(filePath)) return [];
  const body = fs.readFileSync(filePath, 'utf8');
  const out = [];
  const seen = new Set();

  function push(title, rest) {
    const t = title.trim().replace(/:$/, '');
    const id = `policy-${t.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`;
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
 * Build compact style profile (clone-me constraints with provenance).
 * @param {{ projectRoot: string, pluginRoot: string }} opts
 */
function buildStyleProfile(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const pluginRoot = path.resolve(opts.pluginRoot);
  /** @type {Array<{ id: string, text: string, provenance: string }>} */
  const constraints = [];
  const seen = new Set();

  function add(c) {
    if (!c?.text || seen.has(c.id)) return;
    seen.add(c.id);
    constraints.push(c);
  }

  add({
    id: 'docs-drift',
    text: 'Keep CLAUDE.md, AGENTS.md, GEMINI.md, CHANGELOG, and catalog counts in the same change when policy shifts.',
    provenance: 'repo-convention',
  });
  add({
    id: 'zero-deps',
    text: 'Prefer zero new runtime dependencies unless explicitly approved.',
    provenance: 'plan-phase3-seed',
  });
  add({
    id: 'state-authority',
    text: 'state.json and repo artifacts override chat memory and retrieved hints.',
    provenance: 'CLAUDE.md',
  });

  for (const rel of ['CLAUDE.md', 'AGENTS.md']) {
    for (const c of extractBoldGuidelineConstraints(path.join(projectRoot, rel))) add(c);
    if (projectRoot !== pluginRoot) {
      for (const c of extractBoldGuidelineConstraints(path.join(pluginRoot, rel))) add(c);
    }
  }

  const changelog = path.join(pluginRoot, 'CHANGELOG.md');
  if (fs.existsSync(changelog)) {
    const body = fs.readFileSync(changelog, 'utf8');
    if (/UAT.*deleted|removed UAT/i.test(body)) {
      add({
        id: 'uat-deleted',
        text: 'UAT harness was deliberately removed; do not reintroduce without explicit request.',
        provenance: 'CHANGELOG.md',
      });
    }
  }

  try {
    const log = execSync('git log -5 --pretty=format:%s', {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const line of log.split('\n').slice(0, 3)) {
      if (/fix|refactor|test/i.test(line)) {
        add({
          id: `git-${constraints.length}`,
          text: `Recent commit theme: ${line.slice(0, 100)}`,
          provenance: 'git-history',
        });
      }
    }
  } catch {
    /* not a git repo */
  }

  return { version: '1', constraints };
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

module.exports = { buildStyleProfile, writeStyleProfile, extractBoldGuidelineConstraints };
