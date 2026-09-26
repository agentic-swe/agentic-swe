'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

function sha256Text(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function sha256File(filePath) {
  return sha256Text(fs.readFileSync(filePath));
}

module.exports = { sha256Text, sha256File };
