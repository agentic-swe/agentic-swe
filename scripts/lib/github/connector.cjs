'use strict';

/**
 * GitHub connector (AE-015). Reads use a fine-grained read-only token; writes exist but return
 * DENIED_UNAUTHORIZED unless `authorization.github_write` is true. Every call — and every denied
 * write — is handed to the journal sink, which is required.
 */

const fs = require('node:fs');
const path = require('node:path');

const PACK_ROOT = path.resolve(__dirname, '..', '..', '..');
const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

function readJsonOrNull(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Pack `config/github.json`, then `<projectRoot>/.agentic-swe/github.json`. Writes are enabled
 * only by an explicit `authorization.github_write: true`; nothing in the environment enables them.
 */
function loadGitHubConfig({ pluginRoot = PACK_ROOT, projectRoot } = {}) {
  const pack = readJsonOrNull(path.join(pluginRoot, 'config', 'github.json')) || {};
  const repo = projectRoot ? readJsonOrNull(path.join(projectRoot, '.agentic-swe', 'github.json')) || {} : {};
  const authorization = { ...(pack.authorization || {}), ...(repo.authorization || {}) };
  return {
    api_base: pack.api_base || 'https://api.github.com',
    token_env: pack.token_env || ['AGENTIC_SWE_GITHUB_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN'],
    permissions: pack.permissions || { read: [], write: [] },
    codeowners_paths: repo.codeowners_paths || pack.codeowners_paths || ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'],
    authorization: { github_write: authorization.github_write === true },
  };
}

function resolveToken(config, env = process.env) {
  for (const name of config.token_env || []) {
    if (env[name]) return env[name];
  }
  return null;
}

async function fetchTransport({ method, url, headers, body }) {
  const res = await fetch(url, { method, headers, body: body == null ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

function assertRepo(repo) {
  if (typeof repo !== 'string' || !REPO.test(repo)) {
    const err = new Error(`repo must be owner/name, got "${repo}"`);
    err.code = 'BAD_REPO';
    throw err;
  }
}

function seg(v) {
  return encodeURIComponent(String(v));
}

/**
 * @param {{ token?: string|null, transport?: Function, journal: { record: Function },
 *           config?: object, now?: () => string }} opts
 */
function createGitHubConnector(opts) {
  if (!opts || !opts.journal || typeof opts.journal.record !== 'function') {
    throw new Error('createGitHubConnector requires a journal sink');
  }
  const config = opts.config || loadGitHubConfig();
  const transport = opts.transport || fetchTransport;
  const now = opts.now || (() => new Date().toISOString());
  const journal = opts.journal;

  async function call(method, endpoint, body) {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'agentic-swe',
    };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    let res;
    try {
      res = await transport({ method, url: `${config.api_base}${endpoint}`, headers, body });
    } catch (e) {
      journal.record({ at: now(), method, endpoint, status: 0 });
      return { ok: false, code: 'GITHUB_NETWORK_ERROR', status: 0, message: String(e && e.message ? e.message : e) };
    }
    journal.record({ at: now(), method, endpoint, status: res.status });
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, data: res.data };
    const message = res.data && res.data.message ? res.data.message : `HTTP ${res.status}`;
    return { ok: false, code: res.status === 404 ? 'GITHUB_NOT_FOUND' : 'GITHUB_API_ERROR', status: res.status, message: `${method} ${endpoint}: ${message}` };
  }

  const get = (endpoint) => call('GET', endpoint);

  async function paged(endpoint, pick = (d) => d) {
    const out = [];
    const sep = endpoint.includes('?') ? '&' : '?';
    for (let page = 1; page <= MAX_PAGES; page++) {
      const r = await get(`${endpoint}${sep}per_page=${PAGE_SIZE}&page=${page}`);
      if (!r.ok) return r;
      const items = pick(r.data) || [];
      out.push(...items);
      if (items.length < PAGE_SIZE) break;
    }
    return { ok: true, data: out };
  }

  async function write(method, endpoint, body) {
    if (!config.authorization.github_write) {
      journal.record({ at: now(), method, endpoint, status: 'denied' });
      return {
        ok: false,
        code: 'DENIED_UNAUTHORIZED',
        message: `${method} ${endpoint} is a GitHub write; authorization.github_write is false (a human enables it in .agentic-swe/github.json)`,
      };
    }
    return call(method, endpoint, body);
  }

  const repoPath = (repo) => {
    assertRepo(repo);
    const [owner, name] = repo.split('/');
    return `/repos/${seg(owner)}/${seg(name)}`;
  };

  return {
    permissions: config.permissions,
    writeEnabled: config.authorization.github_write,

    getIssue: (repo, number) => get(`${repoPath(repo)}/issues/${seg(number)}`),
    getPull: (repo, number) => get(`${repoPath(repo)}/pulls/${seg(number)}`),
    listPullFiles: (repo, number) => paged(`${repoPath(repo)}/pulls/${seg(number)}/files`),
    listReviews: (repo, number) => paged(`${repoPath(repo)}/pulls/${seg(number)}/reviews`),
    listCheckRuns: (repo, sha) => paged(`${repoPath(repo)}/commits/${seg(sha)}/check-runs`, (d) => d && d.check_runs),
    getCombinedStatus: (repo, sha) => get(`${repoPath(repo)}/commits/${seg(sha)}/status`),
    getBranchRules: (repo, branch) => paged(`${repoPath(repo)}/rules/branches/${seg(branch)}`),
    async getFileText(repo, filePath, ref) {
      const encoded = String(filePath).split('/').map(seg).join('/');
      const r = await get(`${repoPath(repo)}/contents/${encoded}?ref=${seg(ref)}`);
      if (!r.ok) return r;
      if (!r.data || r.data.encoding !== 'base64' || typeof r.data.content !== 'string') {
        return { ok: false, code: 'GITHUB_API_ERROR', message: `${filePath}: not a file` };
      }
      return { ok: true, data: Buffer.from(r.data.content, 'base64').toString('utf8') };
    },
    async isTeamMember(org, team, user) {
      const r = await get(`/orgs/${seg(org)}/teams/${seg(team)}/memberships/${seg(user)}`);
      if (r.ok) return { ok: true, member: Boolean(r.data && r.data.state === 'active') };
      if (r.code === 'GITHUB_NOT_FOUND') return { ok: true, member: false };
      return r;
    },

    createBranch: (repo, { ref, sha }) => write('POST', `${repoPath(repo)}/git/refs`, { ref: `refs/heads/${ref}`, sha }),
    createPull: (repo, { title, head, base, body, draft }) => write('POST', `${repoPath(repo)}/pulls`, { title, head, base, body, draft }),
    createComment: (repo, number, body) => write('POST', `${repoPath(repo)}/issues/${seg(number)}/comments`, { body }),
    createCheckRun: (repo, run) => write('POST', `${repoPath(repo)}/check-runs`, run),
  };
}

module.exports = {
  PACK_ROOT,
  loadGitHubConfig,
  resolveToken,
  fetchTransport,
  createGitHubConnector,
};
