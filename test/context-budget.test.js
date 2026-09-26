'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { estimateContext } = require('../scripts/lib/context-budget/estimate.cjs');

test('estimates components and keeps capped Jev task text separate', () => {
  const result = estimateContext({
    files: [
      { path: 'CLAUDE.md', content: 'one two three four', kind: 'policy' },
      { path: 'mcp.json', content: '{"tools":[{},{}]}', kind: 'mcp' },
    ],
    jevHintText: 'fixed hint',
    jevTaskText: 'capped task',
  });
  assert.equal(result.components.policy, 6);
  assert.equal(result.components.mcpSchemas, 1000);
  assert.equal(result.components.jevHint, 3);
  assert.equal(result.jevTaskText, 3);
  assert.equal(result.total, 1009);
  assert.equal(result.savings[0].action, 'AGENTIC_SWE_JEV=0');
});
