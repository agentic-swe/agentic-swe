'use strict';

const { readJournal, appendEvent } = require('../shared/journal.cjs');

const DEFAULT_CHECK_NAME = 'agentic-swe journal anchor';
const DEFAULT_APP_SLUG = 'agentic-swe';

function anchorSummary({ workId, seq, hash }) {
  return `work_id=${workId}\nseq=${seq}\nhash=${hash}`;
}

function parseSummary(summary) {
  const values = {};
  for (const line of String(summary || '').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) values[line.slice(0, i)] = line.slice(i + 1);
  }
  return values;
}

function checkMatches(run, expected, config) {
  if (!run || run.name !== expected.check_name || run.head_sha !== expected.head_sha) return false;
  if (run.status !== 'completed' || run.conclusion !== 'success') return false;
  const appSlug = run.app && (run.app.slug || run.app.name);
  if (appSlug !== expected.app_slug) return false;
  const parsed = parseSummary(run.output && (run.output.summary || run.output.text));
  return parsed.work_id === expected.work_id &&
    Number(parsed.seq) === expected.seq &&
    parsed.hash === expected.hash;
}

function anchorConfig(config = {}) {
  const anchor = config.anchor || {};
  return {
    check_name: anchor.check_name || DEFAULT_CHECK_NAME,
    app_slug: anchor.app_slug || DEFAULT_APP_SLUG,
  };
}

/**
 * Create at most one immutable check-run anchor for a journal head, then verify
 * it using a read-only GET. The connector itself enforces github_write.
 */
async function anchorHeadHash({ connector, repo, headSha, workId, seq, hash, config, at = new Date().toISOString() }) {
  const defaults = anchorConfig(config);
  const expected = {
    work_id: workId, seq, hash, head_sha: headSha,
    check_name: defaults.check_name, app_slug: defaults.app_slug,
  };
  const existing = await connector.listCheckRuns(repo, headSha);
  if (!existing.ok) return { ok: false, status: 'unanchored', code: existing.code, message: existing.message };
  const found = (existing.data || []).find((run) => {
    if (!run || run.name !== expected.check_name || run.head_sha !== headSha) return false;
    const parsed = parseSummary(run.output && (run.output.summary || run.output.text));
    return parsed.work_id === workId && Number(parsed.seq) === seq;
  });

  let run = found;
  if (!run) {
    if (connector.writeEnabled === false) {
      return { ok: false, status: 'unanchored', code: 'DENIED_UNAUTHORIZED', message: 'GitHub check-run writes are disabled' };
    }
    const created = await connector.createCheckRun(repo, {
      name: expected.check_name,
      head_sha: headSha,
      status: 'completed',
      conclusion: 'success',
      output: {
        title: 'Agentic SWE journal anchor',
        summary: anchorSummary({ workId, seq, hash }),
      },
    });
    if (!created.ok) return { ok: false, status: 'unanchored', code: created.code, message: created.message };
  }

  // Always perform a GET after a write (or an idempotent hit); this is the
  // evidence that the external anchor actually matches the local head hash.
  const verifiedRuns = await connector.listCheckRuns(repo, headSha);
  if (!verifiedRuns.ok) return { ok: false, status: 'unanchored', code: verifiedRuns.code, message: verifiedRuns.message };
  run = (verifiedRuns.data || []).find((candidate) => checkMatches(candidate, expected, config));
  if (!run) {
    return { ok: false, status: 'mismatch', code: 'ANCHOR_MISMATCH', message: 'GitHub check-run anchor did not match the journal head' };
  }
  return {
    ok: true,
    status: 'anchored',
    medium: 'github_check_run',
    identity: expected.app_slug,
    independent: true,
    work_id: workId,
    seq,
    hash,
    head_sha: headSha,
    check_run_id: run.id || null,
    at,
  };
}

function localAnchorReport(workDir, state) {
  const chain = readJournal(workDir);
  if (!chain.ok) return { anchor: 'ANCHOR_MISMATCH' };
  const event = [...chain.events].reverse().find((candidate) => candidate.type === 'github.anchored');
  if (!event) return { anchor: 'none' };
  const payload = event.payload || {};
  const target = chain.events[(Number(payload.seq) || 0) - 1];
  if (!target || target.hash !== payload.hash || payload.work_id !== (state.work_id || null)) {
    return { anchor: 'ANCHOR_MISMATCH', anchorRecord: payload };
  }
  if (payload.status !== 'anchored') return { anchor: 'none', anchorRecord: payload };
  return {
    anchor: `anchored seq ${payload.seq} by ${payload.identity} (${payload.independent ? 'independent' : 'cooperative'})`,
    anchorRecord: payload,
  };
}

async function anchorAndJournal({ workDir, state, connector, link, headSha, config }) {
  const chain = readJournal(workDir);
  if (!chain.ok) return { ok: false, status: 'mismatch', code: 'ANCHOR_MISMATCH' };
  const prior = [...chain.events].reverse().find((event) =>
    event.type === 'github.anchored' && event.payload && event.payload.head_sha === headSha);
  if (prior && prior.payload.status === 'anchored') return prior.payload;
  const seq = chain.events.length ? chain.events[chain.events.length - 1].seq : 0;
  const hash = chain.head;
  if (!seq || !hash) return { ok: false, status: 'unanchored', code: 'NO_JOURNAL_HEAD' };
  const result = await anchorHeadHash({
    connector,
    repo: link.repo,
    headSha,
    workId: state.work_id,
    seq,
    hash,
    config,
  });
  if (result.status === 'anchored') {
    appendEvent(workDir, {
      type: 'github.anchored',
      payload: result,
      idempotency_key: `github-anchor:${link.repo}#${link.pr}:${headSha}:${seq}:${hash}`,
    });
  }
  return result;
}

module.exports = {
  DEFAULT_CHECK_NAME,
  DEFAULT_APP_SLUG,
  anchorConfig,
  anchorHeadHash,
  anchorAndJournal,
  localAnchorReport,
  parseSummary,
};
