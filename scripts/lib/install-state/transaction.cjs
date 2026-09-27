'use strict';

const fs = require('node:fs');
const path = require('node:path');

function beginTransaction() {
  return { created: [], modified: [] };
}

function recordCreated(transaction, filePath) {
  transaction.created.push(filePath);
}

function recordModified(transaction, filePath, content) {
  if (transaction.modified.some((entry) => entry.filePath === filePath)) return;
  transaction.modified.push({ filePath, content });
}

function rollback(transaction) {
  for (const filePath of transaction.created.reverse()) fs.rmSync(filePath, { recursive: true, force: true });
  for (const entry of transaction.modified.reverse()) {
    fs.mkdirSync(path.dirname(entry.filePath), { recursive: true });
    fs.writeFileSync(entry.filePath, entry.content);
  }
}

module.exports = { beginTransaction, recordCreated, recordModified, rollback };
