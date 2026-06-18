// Review Memory (CONTEXT.md "Review Memory" / "Duplicate Finding"; ADR 0003).
//
// PURE logic over an injected plain-object state slice (a `{ [fingerprint]: record }`
// map). The store owns persistence and wires its `review_memory` bucket through
// these functions; tests can exercise the same logic with an in-memory object and
// no credentials/network.
//
// Review Memory is LOCAL ONLY — it lives in the Review System's `data/` store and
// is NEVER written into the Target Project (ADR 0003). It records, per finding:
// the Finding Fingerprint, the affected-code hash, status, and bookkeeping. A new
// finding whose fingerprint matches an existing record AND whose affected code has
// NOT materially changed (same codeHash) is a Duplicate Finding -> skip. If the
// code changed materially (different codeHash), the finding is eligible to review
// again.

function ensure(state) {
  if (state && typeof state === 'object') return state;
  throw new TypeError('reviewMemory: state map is required');
}

/**
 * Look up a recorded finding by fingerprint.
 * @returns {object|null} the stored record or null.
 */
export function getFinding(state, fingerprint) {
  const v = ensure(state)[fingerprint];
  return v ?? null;
}

/**
 * Is this finding a Duplicate Finding? True when a record with the same
 * fingerprint exists AND its codeHash matches (affected code unchanged). When the
 * code changed materially the finding is reviewable again -> not a duplicate.
 *
 * @param {object} args - { fingerprint, codeHash }
 * @returns {boolean}
 */
export function isDuplicate(state, { fingerprint, codeHash }) {
  const prior = getFinding(state, fingerprint);
  if (!prior) return false;
  return prior.codeHash === codeHash;
}

/**
 * Record (or refresh) a finding in Review Memory. Mutates and returns the state
 * map. `now` is injectable for deterministic tests. Updating an existing
 * fingerprint with a new codeHash overwrites it (the code moved on).
 *
 * @param {object} args - { fingerprint, codeHash, projectId?, mrIid?, file?,
 *                          severity?, status? }
 */
export function recordFinding(
  state,
  { fingerprint, codeHash, projectId, mrIid, file, severity, status = 'posted' },
  now = Date.now(),
) {
  const map = ensure(state);
  const prior = map[fingerprint];
  map[fingerprint] = {
    fingerprint,
    codeHash,
    project_id: projectId,
    mr_iid: mrIid,
    file,
    severity,
    status,
    first_seen: prior?.first_seen ?? now,
    last_seen: now,
    seen_count: (prior?.seen_count ?? 0) + 1,
  };
  return map;
}
