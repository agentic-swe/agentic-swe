'use strict';

/**
 * GitHub connector (AE-015 / AE-023b). Reads use a Bearer token (PAT or installation
 * token). Writes are gated per capability (e.g. `checks_anchor` for createCheckRun) and
 * default off; the legacy `authorization.github_write` blanket still gates non-anchor
 * writes and also defaults off. App JWT → installation token minting is available via
 * `app.app_id` / `app.installation_id` / `app.private_key_path` (PEM outside the repo).
 * Every call — and every denied write — is handed to the journal sink, which is required.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  mintInstallationToken,
  readPrivateKeyPem,
} = require('./app-auth.cjs');

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
 * Pack `config/github.json`, then `<projectRoot>/.agentic-swe/github.json`. Write capabilities
 * and `github_write` default false; nothing in the environment enables them.
 */
function mergeSoloFounder(packApproval, repoApproval) {
  const pack = (packApproval && packApproval.solo_founder) || {};
  const repo = (repoApproval && repoApproval.solo_founder) || {};
  const enabledFlag = Object.prototype.hasOwnProperty.call(repo, 'enabled')
    ? repo.enabled === true
    : pack.enabled === true;
  const loginRaw = typeof repo.github_login === 'string' && repo.github_login.trim()
    ? repo.github_login.trim()
    : (typeof pack.github_login === 'string' ? pack.github_login.trim() : '');
  return {
    // Fail closed: explicit true + non-empty login.
    enabled: enabledFlag && Boolean(loginRaw),
    github_login: loginRaw,
  };
}

function loadGitHubConfig({ pluginRoot = PACK_ROOT, projectRoot } = {}) {
  const pack = readJsonOrNull(path.join(pluginRoot, 'config', 'github.json')) || {};
  const repo = projectRoot ? readJsonOrNull(path.join(projectRoot, '.agentic-swe', 'github.json')) || {} : {};
  const authorization = { ...(pack.authorization || {}), ...(repo.authorization || {}) };
  const packCaps = (pack.authorization && pack.authorization.capabilities) || {};
  const repoCaps = (repo.authorization && repo.authorization.capabilities) || {};
  const capabilities = { ...packCaps, ...repoCaps };
  const anchor = { ...(pack.anchor || {}), ...(repo.anchor || {}) };
  const packApp = pack.app || {};
  const repoApp = repo.app || {};
  const solo = mergeSoloFounder(pack.approval, repo.approval);
  return {
    api_base: pack.api_base || 'https://api.github.com',
    token_env: pack.token_env || ['AGENTIC_SWE_GITHUB_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN'],
    permissions: pack.permissions || { read: [], write: [] },
    codeowners_paths: repo.codeowners_paths || pack.codeowners_paths || ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'],
    authorization: {
      github_write: authorization.github_write === true,
      capabilities: {
        checks_anchor: capabilities.checks_anchor === true,
      },
    },
    app: {
      app_id: repoApp.app_id != null ? repoApp.app_id : (packApp.app_id != null ? packApp.app_id : null),
      installation_id: repoApp.installation_id != null ? repoApp.installation_id : (packApp.installation_id != null ? packApp.installation_id : null),
      private_key_path: typeof repoApp.private_key_path === 'string' && repoApp.private_key_path
        ? repoApp.private_key_path
        : (typeof packApp.private_key_path === 'string' ? packApp.private_key_path : null),
    },
    anchor: {
      check_name: anchor.check_name || 'agentic-swe journal anchor',
      app_slug: anchor.app_slug || 'agentic-swe',
    },
    approval: {
      solo_founder: {
        // Fail closed: only an explicit true enables; login must be non-empty.
        enabled: solo.enabled,
        github_login: solo.github_login,
      },
    },
    _roots: { pluginRoot, projectRoot },
  };
}

function resolveToken(config, env = process.env) {
  for (const name of config.token_env || []) {
    if (env[name]) return env[name];
  }
  return null;
}

/**
 * Prefer an env Bearer; otherwise mint an installation token from App credentials
 * when configured. Minting uses the injected transport (no network in unit tests).
 */
async function resolveAccessToken({
  config,
  env = process.env,
  transport = fetchTransport,
  nowMs = Date.now(),
  pluginRoot = PACK_ROOT,
  projectRoot,
} = {}) {
  const existing = resolveToken(config, env);
  if (existing) return { ok: true, token: existing, source: 'env' };
  const app = config && config.app;
  if (!app || app.app_id == null || app.installation_id == null || !app.private_key_path) {
    return { ok: false, code: 'GITHUB_TOKEN_MISSING', message: 'no GitHub token in env and App credentials are incomplete' };
  }
  let pem;
  try {
    pem = readPrivateKeyPem(app.private_key_path, {
      pluginRoot: (config._roots && config._roots.pluginRoot) || pluginRoot,
      projectRoot: (config._roots && config._roots.projectRoot) || projectRoot,
    });
  } catch (error) {
    return { ok: false, code: error.code || 'GITHUB_APP_CONFIG', message: error.message };
  }
  const minted = await mintInstallationToken({
    appId: app.app_id,
    installationId: app.installation_id,
    privateKeyPem: pem,
    transport,
    apiBase: config.api_base || 'https://api.github.com',
    nowMs,
  });
  if (!minted.ok) return minted;
  return { ok: true, token: minted.token, source: 'app_installation', expires_at: minted.expires_at };
}

function writeCapabilityEnabled(config, capability) {
  if (capability === 'checks_anchor') {
    return Boolean(config.authorization && config.authorization.capabilities
      && config.authorization.capabilities.checks_anchor === true);
  }
  return Boolean(config.authorization && config.authorization.github_write === true);
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

  async function write(method, endpoint, body, capability = null) {
    const allowed = writeCapabilityEnabled(config, capability);
    if (!allowed) {
      journal.record({ at: now(), method, endpoint, status: 'denied' });
      const gate = capability
        ? `authorization.capabilities.${capability}`
        : 'authorization.github_write';
      return {
        ok: false,
        code: 'DENIED_UNAUTHORIZED',
        message: `${method} ${endpoint} is a GitHub write; ${gate} is false (a human enables it in .agentic-swe/github.json)`,
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
    // Anchor path uses the checks_anchor capability (defaults off).
    writeEnabled: writeCapabilityEnabled(config, 'checks_anchor'),
    capabilityEnabled: (name) => writeCapabilityEnabled(config, name),

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

    createBranch: (repo, { ref, sha }) => write('POST', `${repoPath(repo)}/git/refs`, { ref: `refs/heads/${ref}`, sha }, null),
    createPull: (repo, { title, head, base, body, draft }) => write('POST', `${repoPath(repo)}/pulls`, { title, head, base, body, draft }, null),
    createComment: (repo, number, body) => write('POST', `${repoPath(repo)}/issues/${seg(number)}/comments`, { body }, null),
    createCheckRun: (repo, run) => write('POST', `${repoPath(repo)}/check-runs`, run, 'checks_anchor'),
  };
}

module.exports = {
  PACK_ROOT,
  loadGitHubConfig,
  resolveToken,
  resolveAccessToken,
  writeCapabilityEnabled,
  fetchTransport,
  createGitHubConnector,
};
