'use strict';

/**
 * Skill routing fallback contract (AE-026b / M3.3).
 *
 * Product matrix (deterministic, offline — PD-9):
 *
 * | Condition                         | code              | action                                      |
 * |-----------------------------------|-------------------|---------------------------------------------|
 * | Catalog has zero skills           | EMPTY_CATALOG     | Return no candidates; never invent skills   |
 * | Autonomous path, every skill gated| ALL_GATED         | Empty selectable results; keep rejected[]   |
 * | Top score below low-confidence    | LOW_CONFIDENCE    | Do not auto-invoke; prefer manual selection |
 * | No relevant / all rejected        | NO_SKILL          | Empty results; surface reject reasons       |
 * | Equal scores among candidates     | TIE_BREAK         | Stable alphabetical name order (see router) |
 *
 * Callers must treat a non-null `fallback` as fail-closed guidance: do not
 * silently pick a skill when code is EMPTY_CATALOG, ALL_GATED, or NO_SKILL.
 */

const FALLBACK_CODES = Object.freeze({
  EMPTY_CATALOG: 'EMPTY_CATALOG',
  ALL_GATED: 'ALL_GATED',
  LOW_CONFIDENCE: 'LOW_CONFIDENCE',
  NO_SKILL: 'NO_SKILL',
  TIE_BREAK: 'TIE_BREAK',
});

const DEFAULT_LOW_CONFIDENCE_SCORE = 0.5;

/**
 * @param {{
 *   catalogSize: number,
 *   results: Array<{ name: string, score: number, autonomous_allowed?: boolean }>,
 *   rejected: Array<{ name: string, reasons: string[] }>,
 *   autonomous?: boolean,
 *   lowConfidenceScore?: number,
 *   tieBroken?: boolean,
 * }} input
 * @returns {{ code: string, reason: string, action: string } | null}
 */
function resolveRoutingFallback(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('resolveRoutingFallback: input object required');
  }
  const catalogSize = Number(input.catalogSize);
  if (!Number.isFinite(catalogSize) || catalogSize < 0) {
    throw new Error('resolveRoutingFallback: catalogSize must be a non-negative number');
  }
  const results = Array.isArray(input.results) ? input.results : null;
  const rejected = Array.isArray(input.rejected) ? input.rejected : null;
  if (results == null || rejected == null) {
    throw new Error('resolveRoutingFallback: results and rejected arrays required');
  }

  if (catalogSize === 0) {
    return {
      code: FALLBACK_CODES.EMPTY_CATALOG,
      reason: 'Skill catalog is empty',
      action: 'Return no candidates; never invent skills',
    };
  }

  const autonomous = input.autonomous === true;
  if (autonomous && results.length === 0 && rejected.length > 0) {
    const allGate = rejected.every(
      (row) => Array.isArray(row.reasons) && row.reasons.includes('EVAL_GATE')
    );
    if (allGate || rejected.some((row) => row.reasons?.includes('EVAL_GATE'))) {
      // Prefer ALL_GATED when every rejected row is gate-blocked and none selectable.
      const onlyGate = rejected.every(
        (row) =>
          Array.isArray(row.reasons) &&
          row.reasons.length > 0 &&
          row.reasons.every((r) => r === 'EVAL_GATE')
      );
      if (onlyGate || rejected.length >= catalogSize) {
        return {
          code: FALLBACK_CODES.ALL_GATED,
          reason: 'All catalog skills blocked by eval gate for autonomous use',
          action: 'Empty selectable results; keep rejected[] with EVAL_GATE',
        };
      }
    }
    return {
      code: FALLBACK_CODES.NO_SKILL,
      reason: 'No selectable skill after routing filters',
      action: 'Empty results; surface reject reasons',
    };
  }

  if (results.length === 0) {
    return {
      code: FALLBACK_CODES.NO_SKILL,
      reason: 'No relevant skill matched the query',
      action: 'Empty results; surface reject reasons',
    };
  }

  const lowBar =
    typeof input.lowConfidenceScore === 'number' && Number.isFinite(input.lowConfidenceScore)
      ? input.lowConfidenceScore
      : DEFAULT_LOW_CONFIDENCE_SCORE;
  const top = results[0];
  const topScore = typeof top?.score === 'number' ? top.score : NaN;
  if (!Number.isFinite(topScore) || topScore < lowBar) {
    return {
      code: FALLBACK_CODES.LOW_CONFIDENCE,
      reason: `Top score ${Number.isFinite(topScore) ? topScore : 'NaN'} below low-confidence bar ${lowBar}`,
      action: 'Do not auto-invoke; prefer manual selection',
    };
  }

  if (input.tieBroken === true) {
    return {
      code: FALLBACK_CODES.TIE_BREAK,
      reason: 'Equal scores resolved by alphabetical skill name',
      action: 'Stable alphabetical name order',
    };
  }

  return null;
}

module.exports = {
  FALLBACK_CODES,
  DEFAULT_LOW_CONFIDENCE_SCORE,
  resolveRoutingFallback,
};
