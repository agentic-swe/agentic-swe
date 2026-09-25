'use strict';

const { SILENT_REASONS, appendJevAudit, classify } = require('./client.cjs');
const { loadJevConfig } = require('./config.cjs');

const TIER_EXPLAIN = {
  fast: 'Prefer a fast/cheap model for shallow work (e.g. haiku-class).',
  balanced: 'A mid-tier model is appropriate (e.g. sonnet-class).',
  heavy: 'Reserve a capable model for deep reasoning or sensitive review (e.g. opus-class).',
};

const TIER_QUESTIONS = {
  tier: {
    type: 'choice',
    instructions:
      'Choose the least costly model tier that can complete the task. Architecture, security, and deep debugging are heavy.',
    criteria: {
      fast: 'Lint, parse, lookup, or a localized shallow edit.',
      balanced: 'Ordinary implementation or review that is not architectural or security-sensitive.',
      heavy: 'Architecture, security, or deep debugging.',
    },
  },
};

function phaseAdvice(phaseTier) {
  return {
    follow: phaseTier,
    phaseTier,
    source: 'phase',
    jev: null,
  };
}

/**
 * @param {{ wid: string, phase: string, phaseTier: string, advice?: { follow: string, phaseTier: string, source: string, jev: object|null }|null }} input
 */
function renderModelTierHint(input) {
  const phaseTier = input.phaseTier || 'balanced';
  const advice = input.advice;
  const follow = advice && advice.follow ? advice.follow : phaseTier;
  const explain = TIER_EXPLAIN[follow] || TIER_EXPLAIN.balanced;
  const jev = advice && advice.jev;
  const jevVisible = Boolean(jev && ((advice.source === 'jev') || (jev.skipped && !SILENT_REASONS.has(jev.skipped))));
  const lines = [
    jevVisible ? '### Model routing (Phase 3 policy, Jev advisory)' : '### Model routing (Phase 3 policy)',
    '',
    `- **Work item:** \`${input.wid}\` — **phase:** \`${input.phase}\` → **tier:** \`${follow}\``,
    `- ${explain}`,
  ];
  if (jev && jev.skipped && !SILENT_REASONS.has(jev.skipped)) {
    lines.push(`- Jev advisory skipped (${jev.skipped}). Using the phase tier \`${phaseTier}\`.`);
  } else if (jev && advice.source === 'jev') {
    lines.push(
      `- Jev advisory: confidence ${Number(jev.confidence).toFixed(2)} chooses \`${jev.choice}\`. Phase tier: \`${phaseTier}\`.`
    );
  }
  lines.push(
    '',
    'Override tiers in `.agentic-swe/model-routing.json` (merge). This hint is advisory; hosts may not enforce model choice.'
  );
  return lines.join('\n');
}

async function adviseModelTier(opts) {
  const phaseTier = opts.phaseTier || 'balanced';
  const task = String(opts.task || '').trim();
  if (!task) return phaseAdvice(phaseTier);
  const env = opts.env || process.env;
  const config = opts.config || loadJevConfig(opts.pluginRoot, opts.projectRoot, env);
  const result = await classify({
    pluginRoot: opts.pluginRoot,
    projectRoot: opts.projectRoot,
    state: `Phase: ${opts.phase || 'unknown'}\nPhase tier: ${phaseTier}\nTask: ${task}`,
    questions: TIER_QUESTIONS,
    stateCap: config.state_cap.tier,
    seam: 'tier',
    workDir: opts.workDir,
    fetchImpl: opts.fetchImpl,
    env,
    config,
    audit: false,
  });
  if (opts.workDir && result.skipped && result.reason !== 'disabled' && result.reason !== 'missing_key') {
    appendJevAudit(opts.workDir, {
      seam: 'tier',
      model: result.model,
      reason: result.reason,
      usage: result.usage,
    });
  }
  if (result.skipped) {
    return {
      follow: phaseTier,
      phaseTier,
      source: 'phase',
      jev: { skipped: result.reason, choice: null, confidence: null, probabilities: null, model: result.model },
    };
  }
  const answer = result.answers.tier;
  const low = answer.confidence < config.choice_confidence_min;
  if (opts.workDir) {
    appendJevAudit(opts.workDir, {
      seam: 'tier',
      model: result.model,
      reason: low ? 'low_confidence' : 'ok',
      usage: result.usage,
    });
  }
  if (low) {
    return {
      follow: phaseTier,
      phaseTier,
      source: 'phase',
      jev: {
        skipped: 'low_confidence',
        choice: answer.choice,
        confidence: answer.confidence,
        probabilities: answer.probabilities,
        model: result.model,
        fallback: 'phase-tier',
      },
    };
  }
  return {
    follow: answer.choice,
    phaseTier,
    source: 'jev',
    jev: {
      skipped: null,
      choice: answer.choice,
      confidence: answer.confidence,
      probabilities: answer.probabilities,
      model: result.model,
      fallback: null,
    },
  };
}

module.exports = {
  TIER_EXPLAIN,
  TIER_QUESTIONS,
  renderModelTierHint,
  adviseModelTier,
};
