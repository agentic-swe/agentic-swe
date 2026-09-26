'use strict';

const { SUPPORTED_HOSTS } = require('../../setup.cjs');

const STATUS = {
  'claude-code': 'stable',
  cursor: 'partial',
  vscode: 'partial',
  codex: 'partial',
  opencode: 'partial',
  antigravity: 'instruction-only',
};

function reportHostParity() {
  return SUPPORTED_HOSTS.map((host) => {
    if (!STATUS[host]) throw new Error(`unknown host parity: ${host}`);
    return { host, status: STATUS[host] };
  });
}

module.exports = { reportHostParity };
