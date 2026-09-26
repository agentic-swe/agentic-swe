'use strict';

const fs = require('node:fs');

function beginTransaction() {
  return { created: [] };
}

function recordCreated(transaction, filePath) {
  transaction.created.push(filePath);
}

function rollback(transaction) {
  for (const filePath of transaction.created.reverse()) fs.rmSync(filePath, { force: true });
}

module.exports = { beginTransaction, recordCreated, rollback };
