// Review planning (PURE; RZ-54/RZ-55). No GitLab/store/config imports, so it is a
// credential-free, unit-testable seam.
//
// Routes each Review Finding through the Review Quality Gate by Review Strictness
// (inline | summarize | drop), then collapses in-run REDUNDANT findings — those
// that share a Finding Fingerprint (same root cause reported multiple times) — to
// a single best instance, keeping the highest-severity one. The reviewer then
// applies cross-run Review Memory (Duplicate Findings) and posts.

import { evaluateFinding } from './reviewGate.js';
import { fingerprint, affectedCodeHash } from './findingFingerprint.js';

// Severity ranking for picking the "best" instance when collapsing in-run
// redundant findings (lower index = more severe).
const SEVERITY_RANK = { blocker: 0, major: 1, minor: 2, nit: 3 };
function severityRank(severity) {
  return SEVERITY_RANK[severity] ?? 99;
}

const PRIVATE_CREDENTIAL_RE =
  /(\bauth[_ -]?token\b|\bsource[- ]?map\b|\bupload[_ -]?token\b|\badmin[_ -]?token\b|\bwrite[_ -]?token\b|\bapi[_ -]?key\b|\bsecret\b|\bpassword\b|\bcredential\b|\bbearer\b)/i;

function isPublicTelemetryDsnNoise(finding) {
  const text = [
    finding.failureMode,
    finding.evidence,
    finding.fixDirection,
    finding.body,
  ]
    .filter(Boolean)
    .join('\n');

  if (!/\bsentry\b/i.test(text) || !/\bdsn\b/i.test(text)) return false;
  return !PRIVATE_CREDENTIAL_RE.test(text);
}

/**
 * PURE: route + in-run redundancy collapse.
 *
 * Pipeline per finding:
 *   1. Drop findings whose target line is not commentable, or whose file is not
 *      in the diff (cannot anchor an inline comment / fingerprint a hunk).
 *   2. Quality Gate route by strictness: inline | summarize | drop.
 *   3. For inline-routed findings, compute the Finding Fingerprint + affected
 *      code hash from the hunk and collapse duplicates within this run, keeping
 *      the highest-severity instance.
 *
 * @param {object} args
 * @param {Array}  args.comments        - raw model findings (tolerant of missing fields)
 * @param {Map}    args.commentableMap  - file -> Set<commentable new-file line>
 * @param {Map}    args.diffByFile      - file -> { new_path, old_path, diff }
 * @param {string} args.strictness      - Review Strictness (default 'high')
 * @returns {{ inline: Array<{finding, fingerprint, codeHash}>,
 *             summarize: Array<{finding, reasons}>,
 *             drop: Array<{finding, reasons}>,
 *             redundant: number }}
 */
export function planFindings({
  comments,
  commentableMap,
  diffByFile,
  strictness = 'high',
}) {
  const summarize = [];
  const drop = [];
  // fingerprint -> { finding, fingerprint, codeHash } (best instance kept)
  const inlineByFp = new Map();
  let redundant = 0;

  for (const c of comments ?? []) {
    if (!c?.file) continue;
    const allowed = commentableMap.get(c.file);
    if (!allowed || !allowed.has(c.line)) {
      drop.push({ finding: c, reasons: ['non-commentable line'] });
      continue;
    }
    const fileEntry = diffByFile.get(c.file);
    if (!fileEntry) {
      drop.push({ finding: c, reasons: ['file not in diff'] });
      continue;
    }
    if (isPublicTelemetryDsnNoise(c)) {
      drop.push({ finding: c, reasons: ['public telemetry DSN is not a credential'] });
      continue;
    }

    const decision = evaluateFinding(c, { strictness });
    if (decision.route === 'drop') {
      drop.push({ finding: c, reasons: decision.reasons });
      continue;
    }
    if (decision.route === 'summarize') {
      summarize.push({ finding: c, reasons: decision.reasons });
      continue;
    }

    // route === inline: fingerprint over the hunk for this line.
    const fp = fingerprint(c, { diff: fileEntry.diff });
    const codeHash = affectedCodeHash({ diff: fileEntry.diff, line: c.line });
    const prior = inlineByFp.get(fp);
    if (!prior) {
      inlineByFp.set(fp, { finding: c, fingerprint: fp, codeHash });
    } else {
      // In-run redundancy: same root cause reported twice -> keep the
      // highest-severity instance, count the collapse.
      redundant += 1;
      if (severityRank(c.severity) < severityRank(prior.finding.severity)) {
        inlineByFp.set(fp, { finding: c, fingerprint: fp, codeHash });
      }
    }
  }

  return {
    inline: [...inlineByFp.values()],
    summarize,
    drop,
    redundant,
  };
}
