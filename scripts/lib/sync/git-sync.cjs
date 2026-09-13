'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execSync } = require('node:child_process');

const SYNC_BRANCH = 'agentic-swe-memory';
const EVENTS_DIR = '.agentic-swe/sync/events';

/**
 * @param {object} event
 * @returns {string}
 */
function signEvent(event, secret) {
  const payload = JSON.stringify(event);
  return crypto.createHmac('sha256', secret || 'local-dev').update(payload).digest('hex');
}

/**
 * Append a redacted memory event to local queue (git-transport sync).
 * @param {{ projectRoot: string, event: object, secret?: string }} opts
 */
function appendLocalEvent(opts) {
  const root = path.resolve(opts.projectRoot);
  const dir = path.join(root, EVENTS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const event = {
    ...opts.event,
    ts: new Date().toISOString(),
    id: crypto.randomUUID(),
  };
  event.sig = signEvent(event, opts.secret);
  const file = path.join(dir, `${event.ts.replace(/[:.]/g, '-')}-${event.id}.json`);
  fs.writeFileSync(file, JSON.stringify(event, null, 2));
  return file;
}

/**
 * Export pending events to git branch (offline-safe: no-op if not a git repo).
 * @param {{ projectRoot: string, remote?: string }} opts
 */
function pushEventsToGitBranch(opts) {
  const root = path.resolve(opts.projectRoot);
  const eventsDir = path.join(root, EVENTS_DIR);
  if (!fs.existsSync(path.join(root, '.git'))) {
    return { ok: false, reason: 'not a git repository' };
  }
  if (!fs.existsSync(eventsDir)) {
    return { ok: true, exported: 0 };
  }
  const files = fs.readdirSync(eventsDir).filter((f) => f.endsWith('.json'));
  if (!files.length) return { ok: true, exported: 0 };

  const worktree = path.join(root, '.agentic-swe', 'sync-worktree');
  fs.mkdirSync(worktree, { recursive: true });
  try {
    execSync(`git worktree add -B ${SYNC_BRANCH} "${worktree}"`, { cwd: root, stdio: 'pipe' });
  } catch {
    try {
      execSync(`git worktree add "${worktree}" ${SYNC_BRANCH}`, { cwd: root, stdio: 'pipe' });
    } catch {
      return { ok: false, reason: 'could not create sync worktree' };
    }
  }

  const dest = path.join(worktree, 'events');
  fs.mkdirSync(dest, { recursive: true });
  for (const f of files) {
    fs.copyFileSync(path.join(eventsDir, f), path.join(dest, f));
    fs.unlinkSync(path.join(eventsDir, f));
  }
  execSync('git add events', { cwd: worktree, stdio: 'pipe' });
  try {
    execSync(`git commit -m "memory-sync: ${files.length} event(s)"`, { cwd: worktree, stdio: 'pipe' });
  } catch {
    /* nothing to commit */
  }
  return { ok: true, exported: files.length, branch: SYNC_BRANCH };
}

/**
 * Merge remote events with supersedes-based conflict resolution.
 * @param {object[]} local
 * @param {object[]} remote
 */
function mergeEvents(local, remote) {
  const byId = new Map();
  for (const e of [...local, ...remote]) {
    const prev = byId.get(e.id);
    if (!prev || (e.ts || '') > (prev.ts || '')) byId.set(e.id, e);
  }
  return [...byId.values()].sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
}

module.exports = {
  SYNC_BRANCH,
  EVENTS_DIR,
  signEvent,
  appendLocalEvent,
  pushEventsToGitBranch,
  mergeEvents,
};
