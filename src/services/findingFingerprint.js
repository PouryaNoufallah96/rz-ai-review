// Finding Fingerprint (CONTEXT.md "Finding Fingerprint"; ADR 0003/0004). PURE.
//
// A stable key for recognizing the SAME Review Finding across review runs, based
// on rule / failure mode, file, and the relevant CHANGED code. Phase one is
// HUNK-based: the fingerprint is derived from the diff hunk that contains the
// finding's line — NOT the whole file — so unrelated edits elsewhere in the file
// do not change the fingerprint (and the same root cause in the same hunk keeps
// the same fingerprint). Semantic anchors are future work.
//
// Two related hashes:
//   - fingerprint(finding, { hunk }) -> identity of the finding (what + where).
//   - affectedCodeHash(...)          -> hash of just the changed code in the hunk,
//                                       so Review Memory can tell whether the code
//                                       materially changed since it was last seen.
// A new finding whose fingerprint matches Review Memory AND whose affectedCodeHash
// is unchanged is a Duplicate Finding (skip). If the code changed, it's eligible
// to review again.

import { sha256 } from '../lib/hash.js';
import { parseUnifiedDiff } from '../lib/diff.js';

function norm(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Extract the diff-hunk context for a given new-file line from a file's unified
 * diff. Returns only the changed/context lines of the SINGLE hunk that contains
 * `targetLine` (added '+' and context ' ' lines, in order), joined by '\n'.
 * Returns '' when the line maps to no hunk. Whole-file noise outside that hunk
 * never affects the result — that's what makes the fingerprint hunk-based.
 *
 * @returns {string}
 */
export function hunkForLine(diff, targetLine) {
  const hunks = parseUnifiedDiff(diff);
  for (const hunk of hunks) {
    const collected = [];
    let newLine = hunk.newStart;
    let contains = false;
    for (const l of hunk.lines) {
      if (l.startsWith('-')) continue; // removed lines have no new-file number
      if (l.startsWith('+') || l.startsWith(' ')) {
        collected.push(l);
        if (newLine === targetLine) contains = true;
        newLine += 1;
      }
    }
    if (contains) return collected.join('\n');
  }
  return '';
}

/**
 * Normalize the changed code of a hunk into a stable string. Strips the leading
 * diff marker and collapses whitespace so cosmetic reflowing within a line does
 * not change the hash, while real code changes do.
 */
function normalizeHunk(hunk) {
  return String(hunk ?? '')
    .split('\n')
    .map((l) => l.replace(/^[+ ]/, ''))
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0)
    .join('\n');
}

/**
 * Hash of ONLY the changed code in the hunk. Used by Review Memory to detect
 * whether the affected code materially changed since a finding was last recorded.
 *
 * @param {object} args - { hunk } OR { diff, line } to derive the hunk.
 * @returns {string}
 */
export function affectedCodeHash({ hunk, diff, line } = {}) {
  const h = hunk != null ? hunk : hunkForLine(diff, line);
  return sha256('ach1', normalizeHunk(h));
}

/**
 * Stable Finding Fingerprint over rule/failureMode + file + changed-code hunk.
 *
 * @param {object} finding - { file, line, failureMode, rule? }
 * @param {object} ctx     - { hunk } OR { diff } (hunk derived from finding.line)
 * @returns {string}
 */
export function fingerprint(finding, { hunk, diff } = {}) {
  const file = finding?.file ?? '';
  // Prefer an explicit rule id when present; otherwise the normalized failure
  // mode is the identity of "what is wrong".
  const what = norm(finding?.rule || finding?.failureMode);
  const resolvedHunk = hunk != null ? hunk : hunkForLine(diff, finding?.line);
  return sha256('ffp1', what, file, normalizeHunk(resolvedHunk));
}
