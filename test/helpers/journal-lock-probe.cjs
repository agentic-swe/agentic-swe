'use strict';

/** Child that attempts a single appendEvent (maxAttempts=1) against WORK_DIR. */

const { appendEvent } = require('../../scripts/lib/shared/journal.cjs');

const workDir = process.env.WORK_DIR;
if (!workDir) {
  console.error('WORK_DIR required');
  process.exit(2);
}

try {
  appendEvent(
    workDir,
    { type: 'test.side', payload: { note: 'probe' }, idempotency_key: 'lock-probe' },
    { maxAttempts: 1, baseDelayMs: 0 }
  );
  console.log(JSON.stringify({ ok: true }));
  process.exit(0);
} catch (err) {
  console.log(JSON.stringify({ ok: false, code: err && err.code, message: err && err.message }));
  process.exit(err && err.code === 'LOCK_TIMEOUT' ? 3 : 1);
}
