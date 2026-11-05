'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-extraneous-dependencies
const Ajv = require('ajv/dist/2020').default;

const { loadGitHubConfig } = require('../scripts/lib/github/connector.cjs');

const root = path.join(__dirname, '..');

describe('github config schema', () => {
  it('pack config/github.json validates against schemas/github-config.schema.json', () => {
    const schema = JSON.parse(fs.readFileSync(path.join(root, 'schemas', 'github-config.schema.json'), 'utf8'));
    const data = JSON.parse(fs.readFileSync(path.join(root, 'config', 'github.json'), 'utf8'));
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    assert.ok(validate(data), validate.errors ? JSON.stringify(validate.errors, null, 2) : '');
    assert.equal(data.approval.solo_founder.enabled, false);
  });

  it('loadGitHubConfig keeps solo_founder off by default and merges repo opt-in', () => {
    const pack = loadGitHubConfig({ pluginRoot: root });
    assert.equal(pack.approval.solo_founder.enabled, false);

    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-solo-cfg-'));
    fs.mkdirSync(path.join(project, '.agentic-swe'));
    fs.writeFileSync(
      path.join(project, '.agentic-swe', 'github.json'),
      JSON.stringify({ approval: { solo_founder: { enabled: true, github_login: 'surajSFDC' } } })
    );
    const merged = loadGitHubConfig({ pluginRoot: root, projectRoot: project });
    assert.equal(merged.approval.solo_founder.enabled, true);
    assert.equal(merged.approval.solo_founder.github_login, 'surajSFDC');
    assert.equal(merged.authorization.github_write, false);
  });

  it('enabled without a login stays disabled (fail closed)', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-solo-cfg-'));
    fs.mkdirSync(path.join(project, '.agentic-swe'));
    fs.writeFileSync(
      path.join(project, '.agentic-swe', 'github.json'),
      JSON.stringify({ approval: { solo_founder: { enabled: true, github_login: '' } } })
    );
    const merged = loadGitHubConfig({ pluginRoot: root, projectRoot: project });
    assert.equal(merged.approval.solo_founder.enabled, false);
  });
});
