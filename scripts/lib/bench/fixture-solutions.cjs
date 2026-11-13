'use strict';

/**
 * Deterministic fixture-adapter solutions for repo-native holdout tasks (AE-034c).
 * Used only by the fixture provider path — never paid; never sole E8 proof.
 */

const fs = require('node:fs');
const path = require('node:path');

const SOLUTIONS = Object.freeze({
  '01-off-by-one': {
    files: {
      'repo/src/counter.js': `/**
 * Bench task 01 — fixed by fixture adapter.
 * @param {unknown[]} arr
 * @returns {number}
 */
export function countItems(arr) {
  return arr.length;
}

export const MODULE_VERSION = '1.0.0';
`,
    },
    implementationNote: 'Fix return to use arr.length without off-by-one.',
  },
  '02-add-retry': {
    files: {
      'repo/src/http-client.js': `'use strict';

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options = {}) {
  const { maxAttempts = 3, baseDelayMs = 100, _fetch } = options;
  const fetcher = _fetch || fetch;
  let delay = baseDelayMs;
  let last;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    last = await fetcher(url);
    if (last.status < 500) return last;
    if (attempt === maxAttempts) break;
    if (delay > 0) await sleep(delay);
    delay *= 2;
  }
  throw new Error(\`exhausted \${maxAttempts} attempts; last status \${last && last.status}\`);
}

module.exports = { fetchWithRetry };
`,
    },
    implementationNote: 'Implement exponential backoff retry on HTTP 5xx only.',
  },
  '03-rate-limiter': {
    files: {
      'repo/src/rate-limiter.js': `'use strict';

class TokenBucket {
  constructor({ capacity, refillRate }) {
    if (!(capacity > 0) || !(refillRate > 0)) {
      throw new RangeError('capacity and refillRate must be > 0');
    }
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.tokens = capacity;
    this.updatedAt = Date.now();
  }

  _refill() {
    const now = Date.now();
    const elapsed = (now - this.updatedAt) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.updatedAt = now;
  }

  tryConsume(n = 1) {
    this._refill();
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }

  getTokens() {
    this._refill();
    return this.tokens;
  }
}

module.exports = { TokenBucket };
`,
    },
    implementationNote: 'Implement TokenBucket with wall-clock refill and RangeError validation.',
  },
});

/**
 * Apply a deterministic fixture solution into a task sandbox (mutates sandbox only).
 * @param {string} taskId
 * @param {string} taskSandboxDir
 * @returns {{ ok: boolean, taskId: string, files: string[] }}
 */
function applyFixtureSolution(taskId, taskSandboxDir) {
  const sol = SOLUTIONS[taskId];
  if (!sol) {
    const err = new Error(`no fixture solution for task ${taskId}`);
    err.code = 'FIXTURE_SOLUTION_MISSING';
    throw err;
  }
  const root = path.resolve(taskSandboxDir);
  const written = [];
  for (const [rel, body] of Object.entries(sol.files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
    written.push(rel);
  }
  return { ok: true, taskId, files: written, implementationNote: sol.implementationNote };
}

function hasFixtureSolution(taskId) {
  return Boolean(SOLUTIONS[taskId]);
}

module.exports = {
  SOLUTIONS,
  applyFixtureSolution,
  hasFixtureSolution,
};
