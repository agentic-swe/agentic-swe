'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildConsumerFleetWorkflowYaml,
  writeConsumerFleetWorkflow,
} = require('../scripts/lib/fleet/consumer-workflow.cjs');

describe('consumer fleet workflow', () => {
  it('builds workflow with independent class and plugin root', () => {
    const yaml = buildConsumerFleetWorkflowYaml({
      projectRoot: '/tmp/consumer',
      pluginRoot: '/tmp/agentic-swe',
    });
    assert.match(yaml, /AGENTIC_SWE_FLEET_EVIDENCE_CLASS: independent/);
    assert.match(yaml, /workflow_dispatch/);
    assert.match(yaml, /fleet-submission/);
    assert.match(yaml, /AGENTIC_SWE_PLUGIN_ROOT/);
  });

  it('writes workflow file into consumer repo', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-wf-'));
    const consumer = path.join(tmp, 'consumer');
    const plugin = path.join(tmp, 'agentic-swe');
    fs.mkdirSync(consumer, { recursive: true });
    fs.mkdirSync(plugin, { recursive: true });

    const r = writeConsumerFleetWorkflow({ projectRoot: consumer, pluginRoot: plugin });
    assert.equal(r.ok, true);
    const workflowPath = path.join(consumer, '.github', 'workflows', 'agentic-swe-fleet.yml');
    assert.ok(fs.existsSync(workflowPath));
    const body = fs.readFileSync(workflowPath, 'utf8');
    assert.match(body, /independent/);

    const r2 = writeConsumerFleetWorkflow({ projectRoot: consumer, pluginRoot: plugin });
    assert.equal(r2.skipped, true);

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
