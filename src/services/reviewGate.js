// Review Quality Gate (CONTEXT.md "Review Quality Gate"; ADR 0002/0004).
//
// PURE module. Decides whether a single Review Finding may be posted inline,
// should only be summarized, or should be dropped — BEFORE anything is posted to
// GitLab. The gate is the posting boundary: a finding goes inline only when it is
// trustworthy AND actionable, not merely because the model produced a concern.
//
// Per ADR 0004 the gate requires, to go inline:
//   - high confidence,
//   - a concrete failureMode,
//   - changed-code evidence,
//   - a clear fixDirection,
//   - an honest severity (one of the known levels).
// (The "no matching Duplicate Finding" requirement from ADR 0004 is enforced
// separately by Review Memory in the posting loop, not here — this module is
// pure and stateless.)
//
// Routing is driven by Review Strictness via a data-driven confidence table, so a
// future lower strictness could inline medium-confidence findings while the
// default `high` strictness only inlines high-confidence ones. The table below is
// the single source of truth for that mapping.

export const SEVERITIES = ['blocker', 'major', 'minor', 'nit'];
export const CONFIDENCES = ['high', 'medium', 'low'];

// Per-strictness confidence routing. For each strictness, `inline` is the minimum
// confidence tier eligible for inline posting and `drop` is the tier that is
// always dropped; everything in between is summarized. Default is `high`.
//
// - high  (default, spec): only high-confidence findings can go inline; medium →
//   summarize; low → drop.
// - medium: high or medium can go inline; low → summarize (still surfaced).
// - low:   high or medium can go inline; low → summarize.
// Unknown strictness falls back to `high` (safest / least noisy).
export const STRICTNESS_ROUTING = {
  high: { inlineMinConfidence: 'high', dropAtOrBelow: 'low' },
  medium: { inlineMinConfidence: 'medium', dropAtOrBelow: null },
  low: { inlineMinConfidence: 'medium', dropAtOrBelow: null },
};

// Lower index = higher confidence.
const CONFIDENCE_RANK = { high: 0, medium: 1, low: 2 };

function confidenceRank(confidence) {
  // A missing/unknown confidence is treated as the LOWEST tier (never high), so a
  // finding lacking confidence can never auto-post inline (backward-compat with
  // model output that predates the schema change).
  return CONFIDENCE_RANK[confidence] ?? CONFIDENCE_RANK.low;
}

function normalizeConfidence(confidence) {
  return CONFIDENCES.includes(confidence) ? confidence : 'low';
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isHonestSeverity(severity) {
  return SEVERITIES.includes(severity);
}

// The non-confidence Quality Gate requirements (ADR 0004). Returns the list of
// missing requirement names; empty means the finding is gate-complete.
function missingGateFields(finding) {
  const missing = [];
  if (!hasText(finding?.failureMode)) missing.push('failureMode');
  if (!hasText(finding?.evidence)) missing.push('evidence');
  if (!hasText(finding?.fixDirection)) missing.push('fixDirection');
  if (!isHonestSeverity(finding?.severity)) missing.push('severity');
  return missing;
}

/**
 * Evaluate a single finding against the Review Quality Gate.
 *
 * @param {object} finding - { confidence, severity, failureMode, evidence,
 *                             fixDirection, ... }
 * @param {object} ctx     - { strictness }
 * @returns {{ route: 'inline'|'summarize'|'drop', reasons: string[] }}
 */
export function evaluateFinding(finding, { strictness = 'high' } = {}) {
  const routing = STRICTNESS_ROUTING[strictness] ?? STRICTNESS_ROUTING.high;
  const confidence = normalizeConfidence(finding?.confidence);
  const rank = confidenceRank(finding?.confidence);
  const reasons = [];

  // 1) Drop the lowest tier outright (low confidence under default/high; under
  //    looser strictness `dropAtOrBelow` is null so nothing is dropped here).
  if (routing.dropAtOrBelow && rank >= confidenceRank(routing.dropAtOrBelow)) {
    reasons.push(`confidence ${confidence} dropped at strictness ${strictness}`);
    return { route: 'drop', reasons };
  }

  // 2) Inline requires meeting the confidence floor for this strictness AND
  //    passing every non-confidence Quality Gate requirement.
  const meetsConfidenceFloor = rank <= confidenceRank(routing.inlineMinConfidence);
  const missing = missingGateFields(finding);

  if (meetsConfidenceFloor && missing.length === 0) {
    reasons.push(`confidence ${confidence} meets inline floor at strictness ${strictness}`);
    return { route: 'inline', reasons };
  }

  // 3) Otherwise summarize: either confidence is below the inline floor (but not
  //    droppable) or a Quality Gate field is missing.
  if (!meetsConfidenceFloor) {
    reasons.push(`confidence ${confidence} below inline floor ${routing.inlineMinConfidence}`);
  }
  if (missing.length > 0) {
    reasons.push(`missing gate fields: ${missing.join(', ')}`);
  }
  return { route: 'summarize', reasons };
}
