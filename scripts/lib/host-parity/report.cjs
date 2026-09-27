'use strict';

const { SUPPORTED_HOSTS } = require('../../setup.cjs');
const COVERAGE = require('../../../config/host-adapters.json');

function statusFor(coverage) {
  if (coverage.native && coverage.start && coverage.stop && coverage.fullScope !== false) return 'stable';
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
