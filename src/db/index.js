import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import {
  getFinding as memGetFinding,
  isDuplicate as memIsDuplicate,
  recordFinding as memRecordFinding,
} from '../services/reviewMemory.js';
import {
  hasLesson as memHasLesson,
  recordLesson as memRecordLesson,
} from '../services/learningMemory.js';

const dbPath = config.DB_PATH.replace(/\.db$/, '.json');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const empty = {
  guide_cache: {},        // projectId -> { file_sha, content, updated_at }
  review_runs: [],        // [{ id, project_id, mr_iid, head_sha, created_at }]
  bot_discussions: {},    // discussion_id -> { project_id, mr_iid, run_id, file_path, new_line, created_at }
  file_review_cache: {},  // hash -> { comments: [...], cached_at, hits }
  learn_cache: {},        // hash -> { decision, cached_at, hits }
  review_memory: {},      // fingerprint -> { fingerprint, codeHash, status, ... } (Review Memory; local-only, ADR 0003)
  learning_memory: {},    // lessonFingerprint -> { evidence_hash, ... } (Learning Memory; local-only, ADR 0003)
  posted_comments: {},    // `${project_id}:${mr_iid}` -> Set-like { [bodyHash]: true }
  usage_stats: {          // running counters
    ai_calls: 0,
    cache_hits_review: 0,
    cache_hits_learn: 0,
    files_filtered: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
  },
  // Review-quality metrics: COUNTERS ONLY (no code, finding bodies, or paths).
  // Verdict distribution + finding-routing totals for tuning (RZ-57). Local.
  review_metrics: {
    runs: 0,
    verdicts: {
      approved: 0,
      'issues-found': 0,
      'needs-human-review': 0,
      skipped: 0,
    },
    routing: {
      posted: 0,
      summarized: 0,
      dropped: 0,
      redundant: 0,
      duplicate: 0,
    },
  },
  _seq: { run_id: 0 },
};

const LIMITS = {
  file_review_cache: 1000,
  learn_cache: 500,
  review_memory: 5000,
  learning_memory: 2000,
};

function load() {
  try {
    const raw = fs.readFileSync(dbPath, 'utf8');
    return { ...empty, ...JSON.parse(raw) };
  } catch {
    return structuredClone(empty);
  }
}

const state = load();
// Migrate older state files
state.file_review_cache ??= {};
state.learn_cache ??= {};
state.review_memory ??= {};
state.learning_memory ??= {};
state.posted_comments ??= {};
state.usage_stats ??= { ...empty.usage_stats };
// Migrate review_metrics, deep-filling any counters older state files lack.
state.review_metrics ??= structuredClone(empty.review_metrics);
state.review_metrics.runs ??= 0;
state.review_metrics.verdicts = {
  ...empty.review_metrics.verdicts,
  ...state.review_metrics.verdicts,
};
state.review_metrics.routing = {
  ...empty.review_metrics.routing,
  ...state.review_metrics.routing,
};

let writeTimer = null;
function persist() {
  // debounce writes — cache lookups during a single review can be frequent
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    fs.writeFileSync(dbPath, JSON.stringify(state, null, 2));
  }, 100);
}
function persistNow() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = null;
  fs.writeFileSync(dbPath, JSON.stringify(state, null, 2));
}

function evictIfOversized(bucket, limit, recencyFields = ['cached_at']) {
  const obj = state[bucket];
  const keys = Object.keys(obj);
  if (keys.length <= limit) return;
  const recencyOf = (rec) => {
    for (const f of recencyFields) {
      if (rec?.[f] != null) return rec[f];
    }
    return 0;
  };
  const sorted = keys
    .map((k) => [k, recencyOf(obj[k])])
    .sort((a, b) => a[1] - b[1]);
  const dropCount = keys.length - limit + Math.floor(limit * 0.1);
  for (let i = 0; i < dropCount; i++) delete obj[sorted[i][0]];
}

export const store = {
  // --- guide cache ---
  getGuide(projectId) {
    return state.guide_cache[projectId] ?? null;
  },
  upsertGuide({ projectId, fileSha, content }) {
    state.guide_cache[projectId] = {
      file_sha: fileSha,
      content,
      updated_at: Date.now(),
    };
    persist();
  },

  // --- review runs ---
  findRun({ projectId, mrIid, headSha }) {
    return state.review_runs.find(
      (r) => r.project_id === projectId && r.mr_iid === mrIid && r.head_sha === headSha,
    );
  },
  insertRun({ projectId, mrIid, headSha }) {
    const existing = store.findRun({ projectId, mrIid, headSha });
    if (existing) return existing;
    state._seq.run_id += 1;
    const run = {
      id: state._seq.run_id,
      project_id: projectId,
      mr_iid: mrIid,
      head_sha: headSha,
      created_at: Date.now(),
    };
    state.review_runs.push(run);
    persist();
    return run;
  },

  // --- bot discussions ---
  insertDiscussion({ discussionId, projectId, mrIid, runId, filePath, newLine }) {
    if (state.bot_discussions[discussionId]) return;
    state.bot_discussions[discussionId] = {
      project_id: projectId,
      mr_iid: mrIid,
      run_id: runId,
      file_path: filePath,
      new_line: newLine,
      created_at: Date.now(),
    };
    persist();
  },
  findDiscussion(discussionId) {
    const v = state.bot_discussions[discussionId];
    return v ? { discussion_id: discussionId, ...v } : null;
  },
  listDiscussionsForMr({ projectId, mrIid }) {
    return Object.entries(state.bot_discussions)
      .filter(([, v]) => v.project_id === projectId && v.mr_iid === mrIid)
      .map(([discussion_id, v]) => ({ discussion_id, ...v }));
  },

  // --- file review cache ---
  getFileReview(key) {
    const v = state.file_review_cache[key];
    if (!v) return null;
    v.hits = (v.hits ?? 0) + 1;
    return v;
  },
  setFileReview(key, comments) {
    state.file_review_cache[key] = {
      comments,
      cached_at: Date.now(),
      hits: 0,
    };
    evictIfOversized('file_review_cache', LIMITS.file_review_cache);
    persist();
  },

  // --- learner decision cache ---
  getLearn(key) {
    const v = state.learn_cache[key];
    if (!v) return null;
    v.hits = (v.hits ?? 0) + 1;
    return v;
  },
  setLearn(key, decision) {
    state.learn_cache[key] = { decision, cached_at: Date.now(), hits: 0 };
    evictIfOversized('learn_cache', LIMITS.learn_cache);
    persist();
  },

  // --- Review Memory (Finding Fingerprints; local-only, ADR 0003) ---
  getFinding(fingerprint) {
    return memGetFinding(state.review_memory, fingerprint);
  },
  // Duplicate Finding: same fingerprint AND unchanged affected code (codeHash).
  isDuplicateFinding({ fingerprint, codeHash }) {
    return memIsDuplicate(state.review_memory, { fingerprint, codeHash });
  },
  recordFinding(record) {
    memRecordFinding(state.review_memory, record);
    evictIfOversized('review_memory', LIMITS.review_memory, ['last_seen', 'first_seen']);
    persist();
  },

  // --- Learning Memory (proposed lessons; local-only, ADR 0003) ---
  hasLesson({ fingerprint, evidenceHash }) {
    return memHasLesson(state.learning_memory, { fingerprint, evidenceHash });
  },
  recordLesson(record) {
    memRecordLesson(state.learning_memory, record);
    evictIfOversized('learning_memory', LIMITS.learning_memory, [
      'last_proposed',
      'first_proposed',
    ]);
    persist();
  },

  // --- posted comment dedup (per MR) ---
  isPosted({ projectId, mrIid, bodyHash }) {
    const k = `${projectId}:${mrIid}`;
    return Boolean(state.posted_comments[k]?.[bodyHash]);
  },
  markPosted({ projectId, mrIid, bodyHash }) {
    const k = `${projectId}:${mrIid}`;
    state.posted_comments[k] ??= {};
    state.posted_comments[k][bodyHash] = true;
    persist();
  },

  // --- usage stats ---
  bumpStat(name, by = 1) {
    state.usage_stats[name] = (state.usage_stats[name] ?? 0) + by;
    persist();
  },
  getStats() {
    return { ...state.usage_stats };
  },

  // --- review-quality metrics (counters only; local-only, RZ-57) ---
  // Increments the run count, the verdict distribution, and (when present) the
  // finding-routing totals. Tolerant of a missing/partial breakdown.
  recordReviewMetrics({ verdict, breakdown } = {}) {
    const m = state.review_metrics;
    m.runs += 1;
    if (verdict && verdict in m.verdicts) {
      m.verdicts[verdict] += 1;
    }
    if (breakdown) {
      for (const key of Object.keys(m.routing)) {
        const n = breakdown[key];
        if (typeof n === 'number') m.routing[key] += n;
      }
    }
    persist();
  },
  getReviewMetrics() {
    return {
      runs: state.review_metrics.runs,
      verdicts: { ...state.review_metrics.verdicts },
      routing: { ...state.review_metrics.routing },
    };
  },

  flush() { persistNow(); },
};

process.on('beforeExit', persistNow);
