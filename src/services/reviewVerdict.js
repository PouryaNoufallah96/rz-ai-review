// Review Verdict selection (CONTEXT.md "Review Verdict"; ADR 0002; PRD stories
// 16-20). PURE module.
//
// Every review run produces ONE explicit, honest outcome instead of leaving the
// result implicit in a comment count. `approved` is a successful, trustworthy
// outcome (silence is valid) — not an error.
//
// Precedence (evaluated top to bottom; first match wins):
//   1. skipped              — the review could not run (no Review Guide, or no
//                             reviewable files). The reviewer already returns skip
//                             objects for these; this verdict reflects that.
//   2. issues-found         — at least one inline Review Finding was posted.
//   3. needs-human-review   — Project Knowledge is insufficient (no compiled
//                             knowledge / no context docs) AND there are unresolved
//                             medium-confidence concerns (summarized, not posted).
//                             The system is UNSURE rather than confident-clean.
//   4. approved             — no high-confidence issues were posted and the system
//                             is confident the change is acceptable.

export const VERDICTS = ['approved', 'issues-found', 'needs-human-review', 'skipped'];

/**
 * @param {object} args
 * @param {number} args.inlineCount    - inline findings posted (Quality Gate passed)
 * @param {number} args.summarizeCount - medium-confidence concerns summarized only
 * @param {object} args.knowledge      - loaded Project Knowledge ({ hasKnowledge,
 *                                        contextDocs, hasGuide, ... })
 * @param {number} args.reviewableFiles - count of files actually reviewed
 * @param {boolean} [args.skipped]     - explicit skip (e.g. no-guide / already-reviewed)
 * @returns {{ verdict: string, reasons: string[] }}
 */
export function selectVerdict({
  inlineCount = 0,
  summarizeCount = 0,
  knowledge = null,
  reviewableFiles = 0,
  skipped = false,
} = {}) {
  const reasons = [];

  // 1) skipped — review couldn't run.
  if (skipped || !knowledge?.hasGuide || reviewableFiles <= 0) {
    reasons.push('review could not run (no guide / no reviewable files)');
    return { verdict: 'skipped', reasons };
  }

  // 2) issues-found — at least one inline finding posted.
  if (inlineCount > 0) {
    reasons.push(`${inlineCount} inline finding(s) posted`);
    return { verdict: 'issues-found', reasons };
  }

  // 3) needs-human-review — knowledge insufficient AND unresolved medium concerns.
  const knowledgeThin =
    !knowledge?.hasKnowledge || !(knowledge?.contextDocs?.length > 0);
  if (knowledgeThin && summarizeCount > 0) {
    reasons.push(
      `insufficient Project Knowledge with ${summarizeCount} unresolved medium concern(s)`,
    );
    return { verdict: 'needs-human-review', reasons };
  }

  // 4) approved — confident-clean.
  reasons.push('no high-confidence issues; change acceptable');
  return { verdict: 'approved', reasons };
}
