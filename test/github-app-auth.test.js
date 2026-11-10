'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createAppJwt,
  assertPrivateKeyPathOutsideRepo,
  mintInstallationToken,
} = require('../scripts/lib/github/app-auth.cjs');
const {
  loadGitHubConfig,
  resolveAccessToken,
  createGitHubConnector,
  writeCapabilityEnabled,
  PACK_ROOT,
} = require('../scripts/lib/github/connector.cjs');
const { memoryCallJournal } = require('../scripts/lib/github/call-journal.cjs');

function ephemeralKeyPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

describe('F-M2 GitHub App JWT / installation token', () => {
  it('createAppJwt produces a verifiable RS256 JWT with Node crypto only', () => {
    const { publicKey, privateKey } = ephemeralKeyPair();
    const nowMs = Date.parse('2026-11-10T12:00:00.000Z');
    const jwt = createAppJwt({ appId: 12345, privateKeyPem: privateKey, nowMs });
    const [h, p, s] = jwt.split('.');
    assert.ok(h && p && s);
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    assert.equal(payload.iss, '12345');
    assert.ok(payload.exp - payload.iat <= 600);
    const ok = crypto.createVerify('RSA-SHA256').update(`${h}.${p}`).end().verify(publicKey, s, 'base64url');
    assert.equal(ok, true);
  });

  it('rejects private_key_path inside the pack or project tree', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-app-proj-'));
    assert.throws(
      () => assertPrivateKeyPathOutsideRepo(path.join(PACK_ROOT, 'secrets', 'app.pem'), {
        pluginRoot: PACK_ROOT,
        projectRoot: project,
      }),
      /must not be inside/
    );
    assert.throws(
      () => assertPrivateKeyPathOutsideRepo(path.join(project, 'app.pem'), {
        pluginRoot: PACK_ROOT,
        projectRoot: project,
      }),
      /must not be inside/
    );
    assert.throws(
      () => assertPrivateKeyPathOutsideRepo('relative.pem', { pluginRoot: PACK_ROOT }),
      /absolute/
    );
    fs.rmSync(project, { recursive: true, force: true });
  });

  it('mintInstallationToken posts JWT and returns fixture token (no live network)', async () => {
    const { privateKey } = ephemeralKeyPair();
    const calls = [];
    const minted = await mintInstallationToken({
      appId: 99,
      installationId: 1001,
      privateKeyPem: privateKey,
      apiBase: 'https://api.github.test',
      transport: async (req) => {
        calls.push(req);
        assert.match(req.url, /\/app\/installations\/1001\/access_tokens$/);
        assert.match(req.headers.Authorization, /^Bearer eyJ/);
        return { status: 201, data: { token: 'ghs_fixture_token', expires_at: '2026-11-10T13:00:00Z' } };
      },
    });
    assert.equal(minted.ok, true);
    assert.equal(minted.token, 'ghs_fixture_token');
    assert.equal(calls.length, 1);
  });

  it('resolveAccessToken mints from App credentials when env token is absent', async () => {
    const { privateKey } = ephemeralKeyPair();
    const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-app-key-'));
    const keyPath = path.join(keyDir, 'app.pem');
    fs.writeFileSync(keyPath, privateKey);
    const config = {
      api_base: 'https://api.github.test',
      token_env: ['AGENTIC_SWE_GITHUB_TOKEN'],
      app: { app_id: 7, installation_id: 8, private_key_path: keyPath },
      _roots: { pluginRoot: PACK_ROOT, projectRoot: path.join(os.tmpdir(), 'other-project') },
    };
    const resolved = await resolveAccessToken({
      config,
      env: {},
      transport: async () => ({ status: 201, data: { token: 'ghs_minted' } }),
    });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.source, 'app_installation');
    assert.equal(resolved.token, 'ghs_minted');
    fs.rmSync(keyDir, { recursive: true, force: true });
  });

  it('checks_anchor defaults off and gates createCheckRun independently of github_write', async () => {
    const pack = loadGitHubConfig({ pluginRoot: PACK_ROOT });
    assert.equal(pack.authorization.github_write, false);
    assert.equal(pack.authorization.capabilities.checks_anchor, false);
    assert.equal(writeCapabilityEnabled(pack, 'checks_anchor'), false);

    const journal = memoryCallJournal();
    const denied = createGitHubConnector({
      token: 't',
      journal,
      config: {
        api_base: 'https://api.github.test',
        authorization: { github_write: true, capabilities: { checks_anchor: false } },
      },
      transport: async () => ({ status: 201, data: { id: 1 } }),
    });
    // Blanket write on, capability off → check-run still denied; comment allowed.
    const check = await denied.createCheckRun('acme/widgets', { name: 'x', head_sha: 'a'.repeat(40) });
    assert.equal(check.code, 'DENIED_UNAUTHORIZED');
    assert.match(check.message, /checks_anchor/);
    const comment = await denied.createComment('acme/widgets', 1, 'hi');
    assert.equal(comment.ok, true);

    const allowed = createGitHubConnector({
      token: 't',
      journal: memoryCallJournal(),
      config: {
        api_base: 'https://api.github.test',
        authorization: { github_write: false, capabilities: { checks_anchor: true } },
      },
      transport: async () => ({ status: 201, data: { id: 2 } }),
    });
    assert.equal(allowed.writeEnabled, true);
    const ok = await allowed.createCheckRun('acme/widgets', { name: 'x', head_sha: 'a'.repeat(40) });
    assert.equal(ok.ok, true);
    const stillDenied = await allowed.createComment('acme/widgets', 1, 'nope');
    assert.equal(stillDenied.code, 'DENIED_UNAUTHORIZED');
  });
});
