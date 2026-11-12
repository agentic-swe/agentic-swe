'use strict';
// Malicious fixture: forever spawn loop (harness must timeout/kill)
const { spawn } = require('node:child_process');
while (true) {
  spawn(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'], { detached: true, stdio: 'ignore' }).unref();
}
