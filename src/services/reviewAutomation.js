// Review Automation gate (RZ-56).
//
// Review Automation is the OPT-IN behavior that decides whether a GitLab MR event
// triggers a review WITHOUT a manual CLI/API command (CONTEXT.md "Review
// Automation"). It is governed by the Target Project's Review Config
// (.rz-review.json `automation`) and constrained by the Target Branch Policy.
//
// This module is PURE: it makes no network/store/IO calls. Only the webhook path
// (src/domain/events.js) consults it — manual CLI/API review (runReview) is NEVER
// automation-gated, because Automation only governs webhook-triggered review.

// Built-in important target branches used when the Target Branch Policy is empty
// (the common "review only what merges to release branches" default).
export const DEFAULT_IMPORTANT_BRANCHES = ['main', 'master', 'develop'];

/**
 * Decide whether a webhook-triggered review is permitted for a given MR.
 *
 * @param {object}   args
 * @param {object}   [args.automation]      Review Config `automation` block.
 * @param {boolean}  [args.automation.enabled]
 * @param {string[]} [args.automation.targetBranchPolicy] Allowed target branches
 *                   (exact match, phase one). Empty => fall back to the built-in
 *                   important-branch set plus defaultBranch.
 * @param {string}   [args.targetBranch]    The MR's target branch.
 * @param {string}   [args.defaultBranch]   The Target Project default branch.
 * @returns {{ allowed: boolean, reason: string }}
 */
export function shouldAutomate({ automation, targetBranch, defaultBranch } = {}) {
  // Opt-in: Automation must be explicitly enabled in the Target Project config.
  if (automation?.enabled !== true) {
    return { allowed: false, reason: 'automation-disabled' };
  }

  const policy = Array.isArray(automation.targetBranchPolicy)
    ? automation.targetBranchPolicy
    : [];

  // Non-empty policy: allow only the exact branches it lists.
  if (policy.length > 0) {
    return policy.includes(targetBranch)
      ? { allowed: true, reason: 'target-branch-in-policy' }
      : { allowed: false, reason: 'target-branch-not-in-policy' };
  }

  // Empty policy: fall back to the built-in important branches plus the Target
  // Project default branch (when known).
  const allowedBranches = new Set(DEFAULT_IMPORTANT_BRANCHES);
  if (defaultBranch) allowedBranches.add(defaultBranch);
  return allowedBranches.has(targetBranch)
    ? { allowed: true, reason: 'target-branch-important' }
    : { allowed: false, reason: 'target-branch-not-important' };
}
