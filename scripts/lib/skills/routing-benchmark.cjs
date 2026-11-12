'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { routeSkills } = require('./skill-router.cjs');

const DEFAULT_FIXTURE_REL = path.join('config', 'skill-routing-benchmark.json');

/**
 * Load and validate the frozen routing-benchmark fixture.
 * Fail closed on missing/corrupt data.
 * @param {string} pluginRoot
 * @param {string} [fixturePath]
 */
function loadBenchmarkFixture(pluginRoot, fixturePath) {
  const root = path.resolve(pluginRoot);
  const file = fixturePath
    ? path.resolve(fixturePath)
    : path.join(root, DEFAULT_FIXTURE_REL);
  if (!fs.existsSync(file)) {
    throw new Error(`routing-benchmark: fixture missing: ${file}`);
  }
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`routing-benchmark: cannot read fixture: ${err.message}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`routing-benchmark: corrupt JSON: ${err.message}`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('routing-benchmark: fixture root must be an object');
  }
  if (data.version !== 1) {
    throw new Error(`routing-benchmark: unsupported fixture version ${data.version}`);
  }
  const thresholds = data.thresholds;
  if (!thresholds || typeof thresholds !== 'object') {
    throw new Error('routing-benchmark: thresholds object required');
  }
  for (const key of ['hit_at_1', 'hit_at_3', 'precision_at_k', 'recall_at_k', 'k']) {
    const v = thresholds[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`routing-benchmark: thresholds.${key} must be a finite number`);
    }
  }
  if (!Array.isArray(data.queries) || data.queries.length === 0) {
    throw new Error('routing-benchmark: queries must be a non-empty array');
  }
  for (const q of data.queries) {
    if (!q || typeof q !== 'object') {
      throw new Error('routing-benchmark: each query must be an object');
    }
    if (typeof q.id !== 'string' || !q.id.trim()) {
      throw new Error('routing-benchmark: query.id required (non-blank)');
    }
    if (typeof q.query !== 'string' || !q.query.trim()) {
      throw new Error(`routing-benchmark: query ${q.id}: query string required (non-blank)`);
    }
    if (!Array.isArray(q.expected) || q.expected.length === 0) {
      throw new Error(`routing-benchmark: query ${q.id}: expected non-empty skill list`);
    }
    for (const name of q.expected) {
      if (typeof name !== 'string' || !name.trim()) {
        throw new Error(`routing-benchmark: query ${q.id}: expected skill names must be non-blank`);
      }
    }
  }
  return { file, data };
}

/**
 * @param {string[]} predicted
 * @param {string[]} expected
 * @param {number} k
 */
function scoreQuery(predicted, expected, k) {
  const top = predicted.slice(0, k);
  const exp = new Set(expected);
  const hitAt = (n) => top.slice(0, n).some((name) => exp.has(name));
  let intersect = 0;
  for (const name of top) {
    if (exp.has(name)) intersect += 1;
  }
  const precision = top.length === 0 ? 0 : intersect / top.length;
  const recall = expected.length === 0 ? 0 : intersect / expected.length;
  return {
    hit_at_1: hitAt(1),
    hit_at_3: hitAt(3),
    hit_at_k: hitAt(k),
    precision,
    recall,
    predicted: top,
  };
}

/**
 * Run the offline routing accuracy benchmark (no network, no LLM).
 * @param {{
 *   pluginRoot: string,
 *   fixturePath?: string,
 *   routeFn?: typeof routeSkills,
 *   transport?: { fetch?: Function } | null,
 * }} opts
 */
function runRoutingBenchmark(opts) {
  if (!opts || typeof opts.pluginRoot !== 'string' || !opts.pluginRoot.trim()) {
    throw new Error('runRoutingBenchmark: pluginRoot required');
  }
  const pluginRoot = path.resolve(opts.pluginRoot);
  const { file, data } = loadBenchmarkFixture(pluginRoot, opts.fixturePath);
  const k = data.thresholds.k;
  const routeFn = typeof opts.routeFn === 'function' ? opts.routeFn : routeSkills;

  let fetches = 0;
  const transport =
    opts.transport ||
    {
      fetch: async () => {
        fetches += 1;
        return { ok: true };
      },
    };

  const perQuery = [];
  for (const q of data.queries) {
    const routed = routeFn({
      pluginRoot,
      query: q.query,
      k,
      transport,
    });
    const predicted = (routed.results || []).map((row) => row.name);
    const scored = scoreQuery(predicted, q.expected, k);
    perQuery.push({
      id: q.id,
      query: q.query,
      expected: [...q.expected],
      ...scored,
    });
  }

  if (fetches !== 0) {
    throw new Error(`routing-benchmark: transport.fetch called ${fetches} times (PD-9)`);
  }

  const n = perQuery.length;
  const avg = (key) => perQuery.reduce((s, row) => s + (row[key] ? 1 : 0), 0) / n;
  const avgNum = (key) => perQuery.reduce((s, row) => s + row[key], 0) / n;

  const metrics = {
    n,
    k,
    hit_at_1: avg('hit_at_1'),
    hit_at_3: avg('hit_at_3'),
    hit_at_k: avg('hit_at_k'),
    precision_at_k: avgNum('precision'),
    recall_at_k: avgNum('recall'),
  };

  const thresholds = data.thresholds;
  const failures = [];
  for (const key of ['hit_at_1', 'hit_at_3', 'precision_at_k', 'recall_at_k']) {
    if (metrics[key] + 1e-12 < thresholds[key]) {
      failures.push({
        metric: key,
        actual: metrics[key],
        threshold: thresholds[key],
      });
    }
  }

  return {
    fixture: file,
    offline: true,
    paid_llm: false,
    metrics,
    thresholds: { ...thresholds },
    pass: failures.length === 0,
    failures,
    queries: perQuery,
  };
}

/**
 * Pretty-print metrics for CLI / CI logs.
 * @param {ReturnType<typeof runRoutingBenchmark>} report
 * @param {{ json?: boolean }} [opts]
 */
function formatBenchmarkReport(report, opts = {}) {
  if (opts.json) {
    return JSON.stringify(report, null, 2);
  }
  const lines = [
    `# skill-route-bench (offline, PD-9)`,
    `fixture: ${report.fixture}`,
    `n=${report.metrics.n} k=${report.metrics.k}`,
    `hit@1=${report.metrics.hit_at_1.toFixed(4)} (threshold ${report.thresholds.hit_at_1})`,
    `hit@3=${report.metrics.hit_at_3.toFixed(4)} (threshold ${report.thresholds.hit_at_3})`,
    `precision@k=${report.metrics.precision_at_k.toFixed(4)} (threshold ${report.thresholds.precision_at_k})`,
    `recall@k=${report.metrics.recall_at_k.toFixed(4)} (threshold ${report.thresholds.recall_at_k})`,
    `pass=${report.pass}`,
  ];
  if (report.failures.length) {
    lines.push('failures:');
    for (const f of report.failures) {
      lines.push(`  - ${f.metric}: actual=${f.actual} < threshold=${f.threshold}`);
    }
  }
  return lines.join('\n');
}

module.exports = {
  DEFAULT_FIXTURE_REL,
  loadBenchmarkFixture,
  scoreQuery,
  runRoutingBenchmark,
  formatBenchmarkReport,
};
