'use strict';

/**
 * AE-034c honesty report builder (ADR-013, PD-41/42).
 * Claims stay partial: limitations + provenance + retained negatives required.
 */

const { PROVENANCE } = require('./provenance.cjs');

/**
 * @param {object} input
 * @returns {object} honesty report JSON
 */
function buildHonestyReport(input) {
  const provider = input.provider || 'fixture';
  const isLocalModel = provider === 'ollama' || provider === 'llama.cpp' || provider === 'llamacpp';
  const label = input.label || (isLocalModel ? 'observed' : 'measured');
  const soleE8 = input.sole_e8_proof === true;
  if (isLocalModel && soleE8) {
    const err = new Error('local ollama/llama.cpp runs cannot be sole E8 proof (PD-41)');
    err.code = 'SOLE_E8_FORBIDDEN';
    throw err;
  }

  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const negatives = tasks.filter((t) => t.delivered !== true || t.negative === true);
  const delivered = tasks.filter((t) => t.delivered === true).length;
  const limitations = Array.isArray(input.limitations) && input.limitations.length
    ? input.limitations
    : [
        'Partial M4 exit bar (PD-42): harness completeness, not broad capability claim.',
        isLocalModel
          ? 'Local model run is labeled observed and is not sole E8 proof (PD-41).'
          : 'Fixture-adapter run is deterministic CI evidence; not a frontier capability claim.',
      ];

  return {
    schema_version: 1,
    kind: 'holdout-honesty-report',
    generated_at: input.generated_at || new Date().toISOString(),
    manifest_id: input.manifest_id || null,
    manifest_digest: input.manifest_digest || null,
    pack_commit: input.pack_commit || null,
    cold_run: input.cold_run !== false,
    e8_cited: Boolean(input.e8_cited),
    provider,
    model_provenance: {
      provider,
      model: input.model || (provider === 'fixture' ? 'deterministic-fixture' : provider),
      label,
      sole_e8_proof: false,
      not_sole_e8_proof: true,
    },
    provenance: input.provenance || PROVENANCE.MEASURED,
    provenance_basis: input.provenance_basis || [
      'acceptance exit codes from hidden oracle score phase',
      'worklog artifacts + transition history (not state.json alone)',
    ],
    summary: {
      tasks: tasks.length,
      delivered,
      negatives_retained: negatives.length,
      pass_rate: tasks.length ? delivered / tasks.length : 0,
    },
    tasks,
    retained_negatives: negatives.map((t) => ({
      id: t.id,
      reason: t.negative_reason || t.scores?.details?.task_pass || 'not delivered',
      scores: t.scores || null,
    })),
    limitations,
    score_independence: {
      method: 'hidden_oracle_score_phase + acceptance + scoreWorklog',
      forbids: 'state.json current_state alone',
    },
  };
}

module.exports = { buildHonestyReport };
