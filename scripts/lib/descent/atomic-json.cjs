'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Replace `file` with pretty JSON. Readers see the previous file or the
 * completed replacement; a crash mid-write leaves the previous file in place.
 * @param {string} file
 * @param {unknown} data
 * @param {{ trailingNewline?: boolean }} [opts]
 */
function writeJsonAtomic(file, data, { trailingNewline = false } = {}) {
  const body = JSON.stringify(data, null, 2) + (trailingNewline ? '\n' : '');
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx');
    fs.writeSync(fd, body);
    fs.fsyncSync(fd);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* not created */ }
    throw err;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

module.exports = { writeJsonAtomic };
