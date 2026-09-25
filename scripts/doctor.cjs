#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { detectHosts } = require('./setup.cjs');

function inspect(options = {}, context = {}) {
  const packRoot = context.packRoot || path.resolve(__dirname, '..');
  const target = path.resolve(options.target || process.cwd());
  const checks = [];
  const add = (name, ok, detail, level = 'required') => checks.push({ name, ok, detail, level });

  add('Node.js', Number(process.versions.node.split('.')[0]) >= 18, process.version);
  add('Pack root', fs.existsSync(path.join(packRoot, 'CLAUDE.md')), packRoot);
  add('State machine', fs.existsSync(path.join(packRoot, 'state-machine.json')), path.join(packRoot, 'state-machine.json'));
  add('Target repository', fs.existsSync(target) && fs.statSync(target).isDirectory(), target);

  const hosts = detectHosts(context.home);
  add('Supported host', hosts.length > 0, hosts.length ? hosts.join(', ') : 'none detected', 'advisory');

  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    add('Project policy', fs.existsSync(path.join(target, 'CLAUDE.md')), path.join(target, 'CLAUDE.md'), 'advisory');
    add('Worklog ignore', hasWorklogIgnore(target), path.join(target, '.gitignore'), 'advisory');
  }

  return {
    ok: checks.every((check) => check.level !== 'required' || check.ok),
    target,
    hosts,
    checks,
  };
}

function hasWorklogIgnore(target) {
  const file = path.join(target, '.gitignore');
  if (!fs.existsSync(file)) return false;
  return /(?:^|\n)\s*\.worklogs\/?\s*(?:$|#)/m.test(fs.readFileSync(file, 'utf8'));
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const targetIndex = args.indexOf('--target');
  const target = targetIndex >= 0 ? args[targetIndex + 1] : process.cwd();
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: agentic-swe doctor [--target <repo>] [--json]');
    return;
  }
  if (targetIndex >= 0 && !target) {
    console.error('error: --target requires a path');
    process.exitCode = 1;
    return;
  }

  const result = inspect({ target });
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('Agentic SWE doctor');
    for (const check of result.checks) {
      const marker = check.ok ? '✓' : check.level === 'required' ? '✗' : '!';
      console.log(`${marker} ${check.name}: ${check.detail}`);
    }
  }
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) main();
else module.exports = { inspect, hasWorklogIgnore };
