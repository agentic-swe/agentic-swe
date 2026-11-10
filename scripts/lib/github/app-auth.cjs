'use strict';

/**
 * GitHub App JWT → installation access token (AE-023b).
 * Uses Node `crypto` only. Network I/O goes through an injected transport
 * (fixtures in tests; no live calls required for evidence).
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function b64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/**
 * Build a GitHub App JWT (RS256, ≤10 minutes).
 * @param {{ appId: string|number, privateKeyPem: string, nowMs?: number }} p
 */
function createAppJwt({ appId, privateKeyPem, nowMs = Date.now() }) {
  if (!appId && appId !== 0) {
    const err = new Error('GitHub App JWT requires appId');
    err.code = 'GITHUB_APP_CONFIG';
    throw err;
  }
  if (typeof privateKeyPem !== 'string' || !privateKeyPem.includes('PRIVATE KEY')) {
    const err = new Error('GitHub App JWT requires a PEM private key');
    err.code = 'GITHUB_APP_CONFIG';
    throw err;
  }
  const iat = Math.floor(nowMs / 1000) - 60;
  const exp = iat + 9 * 60; // GitHub max is 10 minutes
  const signingInput = `${b64urlJson({ alg: 'RS256', typ: 'JWT' })}.${b64urlJson({
    iat,
    exp,
    iss: String(appId),
  })}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKeyPem, 'base64url');
  return `${signingInput}.${signature}`;
}

/**
 * Reject private-key paths that sit inside the pack or project tree.
 * Keys must live outside the repo (e.g. ~/.config/agentic-swe/…).
 */
function assertPrivateKeyPathOutsideRepo(keyPath, { pluginRoot, projectRoot } = {}) {
  if (typeof keyPath !== 'string' || !keyPath.trim()) {
    const err = new Error('private_key_path is required');
    err.code = 'GITHUB_APP_CONFIG';
    throw err;
  }
  if (!path.isAbsolute(keyPath)) {
    const err = new Error('private_key_path must be an absolute path outside the repository');
    err.code = 'GITHUB_APP_CONFIG';
    throw err;
  }
  const resolved = path.resolve(keyPath);
  const banned = [pluginRoot, projectRoot].filter(Boolean).map((root) => path.resolve(root));
  for (const root of banned) {
    const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
    if (resolved === root || resolved.startsWith(prefix)) {
      const err = new Error('private_key_path must not be inside the pack or project tree');
      err.code = 'GITHUB_APP_CONFIG';
      throw err;
    }
  }
  return resolved;
}

function readPrivateKeyPem(keyPath, roots) {
  const resolved = assertPrivateKeyPathOutsideRepo(keyPath, roots);
  try {
    return fs.readFileSync(resolved, 'utf8');
  } catch (error) {
    const err = new Error(`unable to read private_key_path: ${error.message}`);
    err.code = 'GITHUB_APP_CONFIG';
    throw err;
  }
}

/**
 * Mint a short-lived installation access token.
 * Transport must return `{ status, data }` and must not be used with a live
 * network in unit tests — inject a fixture.
 *
 * @returns {Promise<{ ok: true, token: string, expires_at?: string } | { ok: false, code: string, message: string }>}
 */
async function mintInstallationToken({
  appId,
  installationId,
  privateKeyPem,
  transport,
  apiBase = 'https://api.github.com',
  nowMs = Date.now(),
}) {
  if (!installationId && installationId !== 0) {
    return { ok: false, code: 'GITHUB_APP_CONFIG', message: 'installation_id is required' };
  }
  if (typeof transport !== 'function') {
    return { ok: false, code: 'GITHUB_APP_CONFIG', message: 'transport is required for installation token mint' };
  }
  let jwt;
  try {
    jwt = createAppJwt({ appId, privateKeyPem, nowMs });
  } catch (error) {
    return { ok: false, code: error.code || 'GITHUB_APP_CONFIG', message: error.message };
  }
  let res;
  try {
    res = await transport({
      method: 'POST',
      url: `${String(apiBase).replace(/\/$/, '')}/app/installations/${encodeURIComponent(String(installationId))}/access_tokens`,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'agentic-swe',
        Authorization: `Bearer ${jwt}`,
      },
      body: {},
    });
  } catch (error) {
    return {
      ok: false,
      code: 'GITHUB_NETWORK_ERROR',
      message: String(error && error.message ? error.message : error),
    };
  }
  if (!res || res.status < 200 || res.status >= 300 || !res.data || typeof res.data.token !== 'string') {
    const message = res && res.data && res.data.message ? res.data.message : `HTTP ${res && res.status}`;
    return { ok: false, code: 'GITHUB_APP_TOKEN', message: `installation token mint failed: ${message}` };
  }
  return { ok: true, token: res.data.token, expires_at: res.data.expires_at || null, jwt };
}

module.exports = {
  createAppJwt,
  assertPrivateKeyPathOutsideRepo,
  readPrivateKeyPem,
  mintInstallationToken,
};
