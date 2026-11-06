'use strict';

/**
 * Map tool/path/track/risk-flag signals to low|medium|high|critical.
 * Never used to skip mandatory human gates (see humanGateRequired).
 *
 * @param {{
 *   track?: string|null,
 *   toolName?: string,
 *   paths?: string[],
 *   riskFlags?: { level?: string, counts?: object },
 *   restrictedOpId?: string|null,
 *   privileged?: boolean,
 * }} p
 * @returns {'low'|'medium'|'high'|'critical'}
 */
function classifyRisk(p = {}) {
  if (p.restrictedOpId) {
    if (/security_policy|credential|destructive|public_disclosure|paid_commitment|ai_org/.test(p.restrictedOpId)) {
      return 'critical';
    }
    return 'high';
  }
  if (p.privileged) return 'high';
  const level = p.riskFlags && p.riskFlags.level;
  if (level === 'high') return 'high';
  if (level === 'review') return 'medium';
  const paths = Array.isArray(p.paths) ? p.paths : [];
  if (paths.some((x) => /(^|\/)(\.github\/|CODEOWNERS$|security)/i.test(String(x)))) return 'medium';
  if (p.track === 'rigorous') return 'medium';
  return 'low';
}

/**
 * Mandatory human gates are never removed by a low risk class.
 * Lean/standard/rigorous items that enter approval-wait still require AE-015 approval.
 *
 * @param {{ track?: string|null, risk_class?: string, to?: string|null, from?: string|null }} p
 * @returns {{ required: boolean, reason: string }}
 */
function humanGateRequired(p = {}) {
  const to = p.to || null;
  if (to === 'approval-wait' || to === 'ambiguity-wait') {
    return {
      required: true,
      reason: `risk_class=${p.risk_class || 'low'} does not waive human gate at ${to}`,
    };
  }
  if (to === 'completed' && (p.from === 'approval-wait' || !p.from)) {
    return {
      required: true,
      reason: 'transition into completed requires human approval (AE-015)',
    };
  }
  return { required: false, reason: 'no mandatory human gate for this transition' };
}

module.exports = { classifyRisk, humanGateRequired };
