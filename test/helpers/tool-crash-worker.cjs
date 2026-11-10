'use strict';

// Crash injection for F-M2-01c: the tool applies its effect, then the process dies
// before the runner can journal tool.completed.
const fs = require('node:fs');
const { ToolRegistry, ToolRunner } = require('../../scripts/lib/tools/index.cjs');

const [workDir, counter] = process.argv.slice(2);
const allowPdp = { evaluate: () => ({ decision: 'allow', rule_id: 'test.allow', policy_digest: 'a'.repeat(64), risk_class: 'low', reason: 'test' }) };
const registry = new ToolRegistry([{
  manifest: {
    id: 'remote.push', version: '1.0.0', permissions: [], input_schema: { type: 'object' },
    side_effects: 'remote', idempotency: 'non-idempotent', timeout_ms: 5000,
  },
  execute: async () => {
    fs.appendFileSync(counter, 'x');
    process.exit(9);
  },
}]);
new ToolRunner({ registry, workDir, pdp: allowPdp }).run('remote.push', {}, { idempotency_key: 'push-1' });
