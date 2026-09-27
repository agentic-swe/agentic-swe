'use strict';

const { SUPPORTED_HOSTS } = require('../../setup.cjs');

const COVERAGE = {
  'claude-code': { start: true, stop: true, native: true, reason: 'hooks.json runs session start and stop through the shared lifecycle' },
  cursor: { start: true, stop: true, native: true, reason: 'hooks-cursor.json runs session-start and session-stop through the shared lifecycle' },
  opencode: { start: true, stop: true, native: true, reason: 'OpenCode plugin runs hook lifecycle maintenance on each chat turn' },
  vscode: { start: true, stop: true, native: false, reason: 'portable pack includes the lifecycle hooks; VS Code does not execute them' },
  codex: { start: true, stop: true, native: false, reason: 'portable pack includes the lifecycle hooks; Codex does not execute them' },
  antigravity: { start: false, stop: false, native: false, reason: 'GEMINI.md is instruction context; Gemini CLI does not execute session hooks' },
};

function statusFor(coverage) {
  if (coverage.native && coverage.start && coverage.stop) return 'stable';
  if (coverage.start || coverage.stop) return 'partial';
  return 'instruction-only';
}

function reportHostParity() {
  return SUPPORTED_HOSTS.map((host) => {
    const coverage = COVERAGE[host];
    if (!coverage) throw new Error(`unknown host parity: ${host}`);
    return { host, status: statusFor(coverage), reason: coverage.reason };
  });
}

module.exports = { reportHostParity, statusFor };
