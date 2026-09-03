'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  isDogfoodLiveWorkItem,
  countLiveWorklogKinds,
  aggregateProductionTierTotals,
} = require('../scripts/lib/bench/production-tier-totals.cjs');

describe('live worklog provenance', () => {
  it('classifies dogfood vs organic /work items', () => {
    assert.equal(
      isDogfoodLiveWorkItem('live-mined-check-pass', { history: [{ actor: 'human' }] }),
      true
    );
    assert.equal(
      isDogfoodLiveWorkItem('feat-auth', { history: [{ actor: 'dogfood-live-worklogs' }] }),
      true
    );
    assert.equal(
      isDogfoodLiveWorkItem('feat-auth', { history: [{ actor: 'engineer', to: 'pr-creation' }] }),
      false
    );
  });

  it('counts organic vs dogfood under a worklogs root', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-kinds-'));
    const write = (id, state) => {
      const d = path.join(tmp, id);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'state.json'), JSON.stringify(state));
    };
    write('live-mined-x', {
      metrics: { descent_tier: 'L0' },
      history: [{ actor: 'dogfood-live-worklogs' }],
    });
    write('real-work', {
      metrics: { descent_tier: 'L0' },
      history: [{ actor: 'user', to: 'pr-creation' }],
    });
    const kinds = countLiveWorklogKinds(tmp);
    assert.equal(kinds.dogfood, 1);
    assert.equal(kinds.organic, 1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('counts committed organic-worklogs fixtures', () => {
    const root = path.join(__dirname, '..');
    const kinds = countLiveWorklogKinds(path.join(root, 'bench/fixtures/organic-worklogs'));
    assert.ok(kinds.organic >= 1);
  });

  it('counts completed pipeline /work without descent as organic', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-org-'));
    const d = path.join(tmp, 'tui-mascot-sf-agents');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(
      path.join(d, 'state.json'),
      JSON.stringify({
        current_state: 'completed',
        history: [
          { actor: 'hypervisor', from: 'initialized', to: 'feasibility' },
          { actor: 'hypervisor', from: 'validation', to: 'pr-creation' },
          { actor: 'user', from: 'approval-wait', to: 'completed' },
        ],
      })
    );
    const kinds = countLiveWorklogKinds(tmp);
    assert.equal(kinds.dogfood, 0);
    assert.equal(kinds.organic, 1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('does not pad sources.organic with bench organic fixtures', () => {
    const root = path.join(__dirname, '..');
    const agg = aggregateProductionTierTotals(root);
    assert.equal(agg.sources.organic, agg.sources.organic_live);
    assert.ok(agg.sources.organic_fixtures >= 1);
  });
});

describe('bench suite step order', () => {
  it('dogfoods pack-root live worklogs before portfolio measurement', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'scripts/bench/run-bench-suite.cjs'),
      'utf8'
    );
    const dogfood = src.indexOf("name: 'dogfood-live'");
    const portfolio = src.indexOf("name: 'portfolio'");
    const evidence = src.indexOf("name: 'objective-evidence'");
    const organic = src.indexOf("name: 'organic-portfolio'");
    const gitDescent = src.indexOf("name: 'git-descent'");
    const implEntry = src.indexOf("name: 'implementation-entry'");
    assert.ok(dogfood > 0 && portfolio > dogfood, 'dogfood-live must run before portfolio');
    assert.ok(organic > portfolio, 'organic-portfolio must run after portfolio');
    const gitPack = src.indexOf("name: 'git-pack-descent'");
    assert.ok(gitDescent > implEntry && implEntry > 0, 'git-descent must run after implementation-entry');
    assert.ok(gitPack > gitDescent, 'git-pack-descent must run after git-descent');
    const organicDescent = src.indexOf("name: 'organic-descent'");
    assert.ok(organicDescent > gitPack, 'organic-descent must run after git-pack-descent');
    const sessionMine = src.indexOf("name: 'session-mine-descent'");
    assert.ok(sessionMine > organicDescent, 'session-mine-descent must run after organic-descent');
    assert.ok(evidence > sessionMine, 'objective-evidence must run after session-mine-descent');
  });
});
