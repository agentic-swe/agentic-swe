#!/usr/bin/env node
// scripts/render-receipt.cjs
const fs = require('node:fs');
const path = require('node:path');
const { extractReceipt } = require('./lib/receipt/extract.cjs');
const { formatMarkdown, formatJson } = require('./lib/receipt/format.cjs');
const { verifyReceipt } = require('./lib/receipt/verify.cjs');

function parseArgs(argv) {
  const args = { format: 'markdown', workDir: null, workId: null, output: null, verify: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === 'verify') {
      args.verify = true;
      continue;
    }
    if (a === '--work-dir' || a === '-w') args.workDir = argv[++i];
    else if (a.startsWith('--work-dir=')) args.workDir = a.slice('--work-dir='.length);
    else if (a === '--format' || a === '-f') args.format = argv[++i];
    else if (a.startsWith('--format=')) args.format = a.slice('--format='.length);
    else if (a === '--output' || a === '-o') args.output = argv[++i];
    else if (a.startsWith('--output=')) args.output = a.slice('--output='.length);
    else if (!args.workId && !a.startsWith('-')) args.workId = a;
  }
  return args;
}

function resolveWorkDir(args, cwd) {
  if (args.workDir) return path.resolve(args.workDir);
  if (args.verify && args.workId) {
    const candidate = path.resolve(cwd, args.workId);
    if (fs.existsSync(candidate)) return candidate;
  }
  const worklogsDir = path.join(cwd, '.worklogs');
  if (!fs.existsSync(worklogsDir)) {
    throw new Error(`.worklogs/ not found at ${worklogsDir} — pass --work-dir to specify a path`);
  }
  const entries = fs.readdirSync(worklogsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(worklogsDir, e.name));
  if (args.workId) {
    const match = entries.find((d) => path.basename(d) === args.workId);
    if (!match) throw new Error(`work-id ${args.workId} not found in ${worklogsDir}`);
    return match;
  }
  if (entries.length === 0) throw new Error(`no work items in ${worklogsDir}`);
  // newest by mtime
  return entries.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

function main() {
  const args = parseArgs(process.argv);
  const workDir = resolveWorkDir(args, process.cwd());
  if (args.verify) {
    const result = verifyReceipt(workDir);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  const data = extractReceipt(workDir);
  const out = args.format === 'json' ? formatJson(data) : formatMarkdown(data);
  if (args.output) {
    fs.writeFileSync(args.output, out);
    process.stderr.write(`receipt written to ${args.output}\n`);
  } else {
    process.stdout.write(out);
    if (args.format !== 'json') process.stdout.write('\n');
  }
}

if (require.main === module) {
  try { main(); } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { parseArgs, resolveWorkDir, main };
