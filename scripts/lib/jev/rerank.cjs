'use strict';

const { SILENT_REASONS, appendJevAudit, classify } = require('./client.cjs');
const { loadJevConfig } = require('./config.cjs');

function clip(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return s.slice(0, max);
}

function choiceQuestions(candidates) {
  const criteria = {};
  for (const candidate of candidates) {
    criteria[candidate.id] = clip(candidate.text || candidate.id, 240);
  }
  return {
    pick: {
      type: 'choice',
      instructions: 'Which candidate best matches the task? Pick exactly one.',
      criteria,
    },
  };
}

function skillQuestions(results) {
  const questions = {};
  for (const row of results) {
    questions[row.name] = {
      type: 'noul',
      instructions: `This skill is needed for the task: ${row.name}. ${clip(row.kind || '', 80)}`,
    };
  }
  return questions;
}

function baseJev(reason, order, extra) {
  return {
    skipped: reason,
    applied: false,
    order,
    choice: null,
    confidence: null,
    probabilities: null,
    nouls: null,
    model: extra && extra.model ? extra.model : null,
    fallback: extra && extra.fallback ? extra.fallback : 'retrieval',
  };
}

function interpretChoice(candidates, result, config) {
  const original = candidates.map((row) => row.id);
  if (result.skipped) return baseJev(result.reason, original, { model: result.model, fallback: 'retrieval' });
  const answer = result.answers.pick;
  if (answer.confidence < config.choice_confidence_min) {
    return {
      ...baseJev('low_confidence', original, { model: result.model, fallback: 'retrieval' }),
      choice: answer.choice,
      confidence: answer.confidence,
      probabilities: answer.probabilities,
    };
  }
  const rest = original.filter((id) => id !== answer.choice);
  return {
    skipped: null,
    applied: true,
    order: [answer.choice, ...rest],
    choice: answer.choice,
    confidence: answer.confidence,
    probabilities: answer.probabilities,
    nouls: null,
    model: result.model,
    fallback: null,
  };
}

function interpretSkillNouls(results, result, config) {
  const original = results.map((row) => row.name);
  if (result.skipped) return baseJev(result.reason, original, { model: result.model, fallback: 'lexical' });
  const nouls = {};
  const decorated = results.map((row, index) => {
    nouls[row.name] = result.answers[row.name].noul;
    return { name: row.name, index, noul: nouls[row.name] };
  });
  const max = decorated.reduce((acc, row) => Math.max(acc, row.noul), 0);
  if (max < config.noul_floor) {
    return {
      ...baseJev('low_confidence', original, { model: result.model, fallback: 'lexical' }),
      nouls,
    };
  }
  decorated.sort((a, b) => b.noul - a.noul || a.index - b.index);
  return {
    skipped: null,
    applied: true,
    order: decorated.map((row) => row.name),
    choice: null,
    confidence: null,
    probabilities: null,
    nouls,
    model: result.model,
    fallback: null,
  };
}

async function adviseSubagentChoice(opts) {
  const config = opts.config || loadJevConfig(opts.pluginRoot, opts.projectRoot, opts.env || process.env);
  const candidates = (opts.candidates || []).slice(0, config.shortlist).map((row) => ({
    id: row.id,
    text: row.text || row.id,
  }));
  const original = (opts.candidates || []).map((row) => row.id);
  if (candidates.length === 0) {
    return { jev: baseJev(null, original, { fallback: 'retrieval' }) };
  }
  const listed = candidates.map((row) => `- ${row.id}: ${clip(row.text, 240)}`).join('\n');
  const result = await classify({
    pluginRoot: opts.pluginRoot,
    projectRoot: opts.projectRoot,
    state: `Task: ${opts.query || ''}\nCandidates:\n${listed}`,
    questions: choiceQuestions(candidates),
    stateCap: config.state_cap.routing,
    seam: 'subagent',
    workDir: opts.workDir,
    fetchImpl: opts.fetchImpl,
    env: opts.env,
    config,
    audit: false,
  });
  const jev = interpretChoice(candidates, result, config);
  recordRerankAudit(opts.workDir, 'subagent', result, jev);
  return { jev };
}

async function adviseSkillNouls(opts) {
  const config = opts.config || loadJevConfig(opts.pluginRoot, opts.projectRoot, opts.env || process.env);
  const results = (opts.results || []).slice(0, config.shortlist);
  if (results.length === 0) {
    return { jev: baseJev(null, [], { fallback: 'lexical' }) };
  }
  const listed = results.map((row) => `- ${row.name}`).join('\n');
  const result = await classify({
    pluginRoot: opts.pluginRoot,
    projectRoot: opts.projectRoot,
    state: `Task: ${opts.query || ''}\nSkills:\n${listed}`,
    questions: skillQuestions(results),
    stateCap: config.state_cap.routing,
    seam: 'skill',
    workDir: opts.workDir,
    fetchImpl: opts.fetchImpl,
    env: opts.env,
    config,
    audit: false,
  });
  const jev = interpretSkillNouls(results, result, config);
  recordRerankAudit(opts.workDir, 'skill', result, jev);
  return { jev };
}

function recordRerankAudit(workDir, seam, result, jev) {
  if (!workDir) return;
  const reason = jev.applied ? 'ok' : jev.skipped;
  if (!reason || reason === 'disabled' || reason === 'missing_key') return;
  appendJevAudit(workDir, {
    seam,
    model: result.model,
    reason,
    usage: result.usage,
  });
}

function catalogJevSuffix(jev) {
  if (!jev) return [];
  if (jev.applied) return [`jev\t${jev.choice}\t${Number(jev.confidence).toFixed(2)}`];
  if (!jev.skipped || SILENT_REASONS.has(jev.skipped)) return [];
  return [`jev\tskipped\t${jev.skipped}`];
}

function appendJevSkillLines(lines, jev) {
  if (!jev) return lines;
  if (jev.applied) {
    lines.push('');
    lines.push('### Skill route (Jev advisory)');
    lines.push('');
    for (const name of jev.order) {
      lines.push(`- \`${name}\` noul=${Number(jev.nouls[name]).toFixed(2)}`);
    }
    return lines;
  }
  if (jev.skipped && !SILENT_REASONS.has(jev.skipped)) {
    lines.push('');
    lines.push(`- Jev advisory skipped (${jev.skipped}). Using the lexical skill order.`);
  }
  return lines;
}

module.exports = {
  choiceQuestions,
  skillQuestions,
  interpretChoice,
  interpretSkillNouls,
  adviseSubagentChoice,
  adviseSkillNouls,
  catalogJevSuffix,
  appendJevSkillLines,
};
