// Learning Memory (CONTEXT.md "Learning Memory"; ADR 0003; RZ-58).
//
// PURE logic over an injected plain-object state slice. The store wires its
// `learning_memory` bucket through these; tests use an in-memory object.
//
// Learning Memory is LOCAL ONLY — never written into the Target Project. It
// records durable lessons that have ALREADY been PROPOSED as Review Guide updates,
// keyed by a LESSON FINGERPRINT derived from the normalized lesson/guidePatch plus
// the file/failureMode context — deliberately NOT the guide sha.
//
// Why not the guide sha: the old learn decision cache invalidated whenever the
// guide changed, so the SAME lesson got re-proposed after any guide edit. Learning
// Memory fixes that gap: a lesson already proposed is skipped on future replies
// UNLESS the EVIDENCE changes (different reply body / relevant context), regardless
// of how many times the guide sha has moved.

import { sha256 } from '../lib/hash.js';

function norm(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function ensure(state) {
  if (state && typeof state === 'object') return state;
  throw new TypeError('learningMemory: state map is required');
}

/**
 * Stable lesson fingerprint over the normalized lesson/guidePatch + file +
 * failureMode/reason context. Independent of the Review Guide sha.
 *
 * @param {object} args - { guidePatch, file?, failureMode? }
 * @returns {string}
 */
export function lessonFingerprint({ guidePatch, file, failureMode } = {}) {
  return sha256('lm1', norm(guidePatch), norm(file), norm(failureMode));
}

/**
 * Hash of the EVIDENCE behind a lesson (the reply body / relevant context). When
 * this changes for the same lesson fingerprint, the lesson is eligible to be
 * proposed again.
 *
 * @param {object} args - { body, ...extra }
 * @returns {string}
 */
export function evidenceHash({ body, extra } = {}) {
  return sha256('lev1', norm(body), norm(extra));
}

/**
 * Has this lesson already been proposed with the SAME evidence? True only when a
 * record exists for the fingerprint AND its evidenceHash matches. Changed evidence
 * -> false (eligible again). Always false for an unseen lesson.
 *
 * @param {object} args - { fingerprint, evidenceHash }
 * @returns {boolean}
 */
export function hasLesson(state, { fingerprint, evidenceHash: evHash }) {
  const prior = ensure(state)[fingerprint];
  if (!prior) return false;
  return prior.evidence_hash === evHash;
}

/**
 * Record a proposed lesson. Mutates and returns the state map. `now` is
 * injectable for deterministic tests.
 *
 * @param {object} args - { fingerprint, evidenceHash, mrIid?, file? }
 */
export function recordLesson(
  state,
  { fingerprint, evidenceHash: evHash, mrIid, file },
  now = Date.now(),
) {
  const map = ensure(state);
  const prior = map[fingerprint];
  map[fingerprint] = {
    fingerprint,
    evidence_hash: evHash,
    mr_iid: mrIid,
    file,
    first_proposed: prior?.first_proposed ?? now,
    last_proposed: now,
    propose_count: (prior?.propose_count ?? 0) + 1,
  };
  return map;
}
