'use strict';

/**
 * Child worker for AE-020a concurrent appendEvent stress test.
 * Env: WORK_DIR, WORKER_ID, COUNT (default 50)
 */

const { appendEvent } = require('../../scripts/lib/shared/journal.cjs');

const workDir = process.env.WORK_DIR;
const workerId = process.env.WORKER_ID;
const count = Number(process.env.COUNT || 50);
const maxAttempts = Number(process.env.MAX_ATTEMPTS || 500);

if (!workDir || workerId == null) {
  console.error('WORK_DIR and WORKER_ID required');
  process.exit(2);
}

try {
  for (let i = 0; i < count; i++) {
    appendEvent(
      workDir,
      {
        type: 'test.side',
        payload: { n: i },
        idempotency_key: `c${workerId}-e${i}`,
      },
      { maxAttempts, baseDelayMs: 5, ttlMs: 30_000 }
    );
  }
  process.exit(0);
} catch (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}
