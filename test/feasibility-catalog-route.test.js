'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  formatCatalogRoutingSection,
  upsertCatalogRoutingSection,
} = require('../scripts/lib/feasibility/catalog-signals.cjs');

const script = path.join(__dirname, '..', 'scripts', 'feasibility-catalog-route.cjs');

describe('feasibility catalog routing', () => {
  it('formats and upserts Catalog Routing section', () => {
    const section = formatCatalogRoutingSection({
      query: 'typescript api',
      mode: 'lexical',
      hits: [{ id: 'language-specialists/typescript-pro', score: 3 }],
    });
    assert.match(section, /## Catalog Routing/);
    assert.match(section, /typescript-pro/);
    const next = upsertCatalogRoutingSection('# Feasibility\n\nhello\n', section);
    assert.match(next, /## Catalog Routing/);
    const twice = upsertCatalogRoutingSection(next, section);
    assert.equal((twice.match(/## Catalog Routing/g) || []).length, 1);
  });

  it('CLI writes section into feasibility.md', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'feas-cat-'));
    const workDir = path.join(tmp, '.worklogs', 'w1');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, 'feasibility.md'), '# Feasibility\n\n## Task\n\nAdd retries\n');
    const r = spawnSync(
      process.execPath,
      [script, '--work-dir', workDir, '--query', 'typescript node api retry', '--k', '3', '--json'],
      { encoding: 'utf8' }
    );
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const body = fs.readFileSync(path.join(workDir, 'feasibility.md'), 'utf8');
    assert.match(body, /## Catalog Routing/);
    assert.match(body, /Top-k/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
