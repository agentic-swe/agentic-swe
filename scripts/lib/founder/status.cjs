'use strict';

/**
 * Founder status (AE-017): goals, items waiting on a human, unresolved high findings, cost with
 * its source, and journal integrity for every work item under <project>/.worklogs. Reads local
 * files only; GitHub is consulted only when the caller passes a verifier (AE-015 read access).
 */

const fs = require('node:fs');
const path = require('node:path');
const { integrityReport, verifyWorkJournal } = require('../work-engine/journal.cjs');
const { reviewSummary } = require('../work-engine/reviews.cjs');
const { parsePrLink, latestVerification } = require('../github/verification.cjs');

const HIGH = new Set(['high', 'critical']);
const GOAL_NEEDS_HUMAN = { 'goal-approval': 'approval', 'goal-gate': 'gate', 'goal-escalated': 'escalation' };

function readJsonOrNull(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function needsHuman(state) {
  if (state === 'approval-wait') return 'approval';
  if (state === 'ambiguity-wait') return 'ambiguity';
  if (/^escalate-/.test(state)) return 'escalation';
  if (state === 'pipeline-failed') return 'failed';
  return null;
}

/**
 * Transcript-synced cost is provider-reported token usage priced by the local table, so it is an
 * estimate; only a ledger that records `source: "provider-reported"` is labeled that way.
 */
function costOf(state) {
  const budget = (state && state.budget) || {};
  const used = typeof budget.cost_used === 'number' ? budget.cost_used : 0;
  const ledger = budget.cost_ledger || null;
  if (ledger && ledger.source === 'provider-reported') {
    return { usd: used, source: 'provider-reported', basis: 'provider cost' };
  }
  if (ledger && ledger.transcript_path) {
    return { usd: used, source: 'estimated', basis: 'transcript token usage × pricing table' };
  }
  if (used > 0) return { usd: used, source: 'estimated', basis: 'no cost ledger' };
  return { usd: 0, source: 'none', basis: 'no cost recorded' };
}

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    return [];
  }
}

function collectWorkItems(worklogs) {
  const items = [];
  for (const id of listDirs(worklogs)) {
    if (id === 'goals') continue;
    const workDir = path.join(worklogs, id);
    const state = readJsonOrNull(path.join(workDir, 'state.json'));
    if (!state) {
      const chain = verifyWorkJournal(workDir);
      if (chain.ok && !chain.missing) {
        items.push({ id, work_dir: workDir, current_state: null, integrity: 'state.json unreadable (journal intact; `dispatch resume` or recover)' });
      }
      continue;
    }
    const integrity = integrityReport(workDir, state).integrity;
    const reviews = reviewSummary(state);
    const high = reviews.unresolved_blocking.filter((f) => HIGH.has(f.severity));
    const link = parsePrLink(workDir);
    let github = null;
    if (link) {
      const v = latestVerification(workDir);
      github = { repo: link.repo, pr: link.pr, url: link.url, last_verdict: v.ok && v.verification ? v.verification.verdict : null };
    }
    items.push({
      id: state.work_id || id,
      work_dir: workDir,
      current_state: state.current_state,
      track: (state.pipeline && state.pipeline.track) || null,
      needs_human: needsHuman(state.current_state),
      integrity,
      cost: costOf(state),
      high_findings: high,
      github,
    });
  }
  return items;
}

function collectGoals(worklogs) {
  const goals = [];
  const goalsDir = path.join(worklogs, 'goals');
  for (const id of listDirs(goalsDir)) {
    const goalDir = path.join(goalsDir, id);
    const goal = readJsonOrNull(path.join(goalDir, 'goal.json'));
    if (!goal) continue;
    const integrity = integrityReport(goalDir, goal, { stateFile: 'goal.json' }).integrity;
    const plan = goal.dispatch && goal.dispatch.plan;
    const children = Array.isArray(goal.children) ? goal.children : [];
    let dispatch = null;
    if (plan) {
      const states = plan.nodes.map((n) => {
        const s = readJsonOrNull(path.join(worklogs, n.work_id, 'state.json'));
        return s ? s.current_state : 'not-started';
      });
      dispatch = { planned: plan.nodes.length, completed: states.filter((s) => s === 'completed').length, started: states.filter((s) => s !== 'not-started').length };
    }
    const b = goal.budget || {};
    goals.push({
      id: goal.goal_id || id,
      goal_dir: goalDir,
      objective: goal.objective,
      current_state: goal.current_state,
      needs_human: GOAL_NEEDS_HUMAN[goal.current_state] || null,
      integrity,
      children: children.length,
      dispatch,
      budget: {
        child_items: `${b.child_items_used || 0}/${b.max_child_items}`,
        loop_turns: `${b.loop_turns_used || 0}/${b.max_loop_turns}`,
        cost_usd: `${(b.cost_used || 0).toFixed(2)}/${b.cost_budget_usd}`,
      },
    });
  }
  return goals;
}

/**
 * @param {{ projectRoot: string, verifier?: (item: object) => Promise<object> }} opts
 */
async function collectFounderStatus({ projectRoot, verifier }) {
  const worklogs = path.join(path.resolve(projectRoot), '.worklogs');
  const items = collectWorkItems(worklogs);
  const goals = collectGoals(worklogs);
  if (verifier) {
    for (const item of items) {
      if (item.needs_human === 'approval' && item.github) item.github.live = await verifier(item);
    }
  }
  const attention = [
    ...goals.filter((g) => g.needs_human).map((g) => ({ kind: 'goal', id: g.id, state: g.current_state, needs: g.needs_human })),
    ...items.filter((i) => i.needs_human).map((i) => ({ kind: 'work', id: i.id, state: i.current_state, needs: i.needs_human, pr: i.github ? i.github.url : null })),
  ];
  const findings = items.flatMap((i) => i.high_findings.map((f) => ({ item: i.id, ...f })));
  const integrityProblems = [...goals, ...items].filter((x) => x.integrity !== 'verified').map((x) => ({ id: x.id, integrity: x.integrity }));
  const cost = { estimated_usd: 0, provider_reported_usd: 0 };
  for (const i of items) {
    if (!i.cost) continue;
    if (i.cost.source === 'estimated') cost.estimated_usd += i.cost.usd;
    if (i.cost.source === 'provider-reported') cost.provider_reported_usd += i.cost.usd;
  }
  cost.estimated_usd = Number(cost.estimated_usd.toFixed(6));
  cost.provider_reported_usd = Number(cost.provider_reported_usd.toFixed(6));
  return { ok: true, project_root: path.resolve(projectRoot), goals, attention, high_findings: findings, integrity_problems: integrityProblems, cost, items };
}

function formatFounderStatus(s) {
  const out = [];
  out.push(`Goals (${s.goals.length})`);
  for (const g of s.goals) {
    const d = g.dispatch ? ` dispatch ${g.dispatch.completed}/${g.dispatch.planned} completed` : '';
    out.push(`  ${g.id}  ${g.current_state}${d}  children ${g.budget.child_items}  turns ${g.budget.loop_turns}  cost $${g.budget.cost_usd}  integrity ${g.integrity}`);
  }
  out.push('', `Needs you (${s.attention.length})`);
  for (const a of s.attention) out.push(`  ${a.kind} ${a.id}  ${a.state} (${a.needs})${a.pr ? `  ${a.pr}` : ''}`);
  out.push('', `Unresolved high findings (${s.high_findings.length})`);
  for (const f of s.high_findings) out.push(`  ${f.item}  ${f.phase}  ${f.reviewer}  ${f.id} ${f.severity}: ${f.summary}`);
  out.push('', `Integrity problems (${s.integrity_problems.length})`);
  for (const p of s.integrity_problems) out.push(`  ${p.id}: ${p.integrity}`);
  out.push('', `Cost: $${s.cost.estimated_usd.toFixed(4)} estimated, $${s.cost.provider_reported_usd.toFixed(4)} provider-reported`);
  out.push('', `Work items (${s.items.length})`);
  for (const i of s.items) {
    const cost = i.cost ? `$${i.cost.usd.toFixed(4)} ${i.cost.source}` : '-';
    const gh = i.github ? `  ${i.github.repo}#${i.github.pr}${i.github.last_verdict ? ` verdict ${i.github.last_verdict}` : ''}${i.github.live ? ` live ${i.github.live.approved ? 'approved' : 'not approved'}` : ''}` : '';
    out.push(`  ${i.id}  ${i.current_state || '?'}  ${i.track || '-'}  ${cost}  integrity ${i.integrity}${gh}`);
  }
  return out.join('\n');
}

module.exports = { costOf, collectFounderStatus, formatFounderStatus };
