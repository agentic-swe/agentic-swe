'use strict';

const { appendJevAudit, classify } = require('./client.cjs');
const { loadJevConfig } = require('./config.cjs');

const TRACK_QUESTIONS = {
  track: {
    type: 'choice',
    instructions:
      'Which pipeline track fits this feasibility writeup? If unsure between standard and rigorous, choose rigorous.',
    criteria: {
      lean: 'Narrow scope, localized impact, no architectural expansion, low risk; review can converge within two iterations.',
      standard:
        'Multi-file or meaningful design and test work without a design panel, design-review, code-review, or permissions-check.',
      rigorous:
        'Security, migration, public API, or architectural change that needs the full governance path.',
    },
  },
  security_sensitive: {
    type: 'noul',
    instructions: 'The change touches authentication, authorization, secrets, or another security-sensitive surface.',
  },
  schema_or_migration: {
    type: 'noul',
    instructions: 'The change includes a schema change, data migration, or config migration.',
  },
  multi_module: {
    type: 'noul',
    instructions: 'The change spans more than one module.',
  },
};

function emptyTrack(reason, model) {
  return {
    choice: null,
    probabilities: null,
    confidence: null,
    nouls: null,
    model: model || null,
    skipped: reason,
    caution: null,
    fallback: 'heuristic+atr',
  };
}

function interpretTrack(result, config) {
  if (result.skipped) return emptyTrack(result.reason, result.model);
  const track = result.answers.track;
  const nouls = {
    security_sensitive: result.answers.security_sensitive.noul,
    schema_or_migration: result.answers.schema_or_migration.noul,
    multi_module: result.answers.multi_module.noul,
  };
  const riskHigh = Object.values(nouls).some((n) => n > config.risk_noul_caution);
  const low = track.confidence < config.choice_confidence_min;
  return {
    choice: track.choice,
    probabilities: track.probabilities,
    confidence: track.confidence,
    nouls,
    model: result.model,
    skipped: low ? 'low_confidence' : null,
    caution: track.choice === 'lean' && riskHigh ? 'risk nouls argue against lean' : null,
    fallback: low ? 'heuristic+atr' : null,
  };
}

/**
 * Advisory track classification. Does not select pipeline.track.
 */
async function adviseTrack(opts) {
  const env = opts.env || process.env;
  const config = opts.config || loadJevConfig(opts.pluginRoot, opts.projectRoot, env);
  const result = await classify({
    pluginRoot: opts.pluginRoot,
    projectRoot: opts.projectRoot,
    state: opts.feasibilityText || '',
    questions: TRACK_QUESTIONS,
    stateCap: config.state_cap.track,
    seam: 'track',
    workDir: opts.workDir,
    fetchImpl: opts.fetchImpl,
    env,
    config,
    audit: false,
  });
  const hint = interpretTrack(result, config);
  if (opts.workDir) {
    appendJevAudit(opts.workDir, {
      seam: 'track',
      model: hint.model,
      reason: hint.skipped || 'ok',
      usage: result.usage,
    });
  }
  return hint;
}

function renderTrackHint(hint) {
  const lines = ['### Jev track hint', ''];
  if (hint.skipped && hint.choice == null) {
    lines.push(`- **skipped:** \`${hint.skipped}\``);
    lines.push('- **fallback:** phase heuristic and Adaptive Track Router');
    lines.push('- `pipeline.track` stays unchanged');
    return lines.join('\n');
  }
  lines.push(`- **choice:** \`${hint.choice}\``);
  lines.push(`- **confidence:** ${Number(hint.confidence).toFixed(2)}`);
  lines.push(`- **skipped:** ${hint.skipped ? `\`${hint.skipped}\`` : '(none)'}`);
  lines.push(`- **caution:** ${hint.caution ? `\`${hint.caution}\`` : '(none)'}`);
  if (hint.nouls) {
    const parts = Object.entries(hint.nouls)
      .map(([key, value]) => `${key}=${Number(value).toFixed(2)}`)
      .join(' ');
    lines.push(`- **nouls:** ${parts}`);
  }
  lines.push('- **fallback:** phase heuristic and Adaptive Track Router when skipped is set');
  lines.push('- `pipeline.track` stays unchanged');
  return lines.join('\n');
}

module.exports = {
  TRACK_QUESTIONS,
  interpretTrack,
  adviseTrack,
  renderTrackHint,
};
