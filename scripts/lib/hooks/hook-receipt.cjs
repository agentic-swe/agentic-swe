'use strict';

const fs = require('node:fs');
const path = require('node:path');

function receiptPath(projectRoot) {
  return path.join(projectRoot, '.agentic-swe', 'hook-receipts.jsonl');
}

function noticePath(projectRoot) {
  return path.join(projectRoot, '.agentic-swe', 'hook-notice.md');
}

function ensureDir(projectRoot) {
  fs.mkdirSync(path.join(projectRoot, '.agentic-swe'), { recursive: true });
}

/**
 * @param {{ projectRoot: string, hook: string, ok: boolean, failures?: object[], steps?: object }} input
 */
function writeHookReceipt(input) {
  const projectRoot = input.projectRoot;
  ensureDir(projectRoot);
  const receipt = {
    ts: new Date().toISOString(),
    hook: input.hook,
    ok: input.ok === true,
    failures: input.failures || [],
    steps: input.steps || {},
  };
  fs.appendFileSync(receiptPath(projectRoot), `${JSON.stringify(receipt)}\n`);
  writeNotice(projectRoot);
  return receipt;
}

function readRecentReceipts(projectRoot, limit = 8) {
  const file = receiptPath(projectRoot);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  return lines.slice(-limit).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function writeNotice(projectRoot) {
  const failed = readRecentReceipts(projectRoot, 12).filter((receipt) => receipt.ok === false);
  const file = noticePath(projectRoot);
  if (!failed.length) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return '';
  }
  const lines = [
    '## Hook failures',
    '',
    'Recent automatic memory hooks failed. The session continues; these receipts are the diagnostic.',
    '',
  ];
  for (const receipt of failed.slice(-5)) {
    const detail = (receipt.failures || []).map((failure) => `${failure.step}: ${failure.message}`).join('; ');
    lines.push(`- ${receipt.ts} \`${receipt.hook}\` ${detail || 'failed'}`);
  }
  const body = `${lines.join('\n')}\n`;
  fs.writeFileSync(file, body);
  return body;
}

function readHookNotice(projectRoot) {
  const file = noticePath(projectRoot);
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8');
}

module.exports = {
  writeHookReceipt,
  readRecentReceipts,
  readHookNotice,
  receiptPath,
  noticePath,
};
