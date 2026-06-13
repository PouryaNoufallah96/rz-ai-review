import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const dbPath = config.DB_PATH.replace(/\.db$/, '.json');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const empty = {
  guide_cache: {},        // projectId -> { file_sha, content, updated_at }
  review_runs: [],        // [{ id, project_id, mr_iid, head_sha, created_at }]
  bot_discussions: {},    // discussion_id -> { project_id, mr_iid, run_id, file_path, new_line, created_at }
  file_review_cache: {},  // hash -> { comments: [...], cached_at, hits }
  learn_cache: {},        // hash -> { decision, cached_at, hits }
  posted_comments: {},    // `${project_id}:${mr_iid}` -> Set-like { [bodyHash]: true }
  usage_stats: {          // running counters
    ai_calls: 0,
    cache_hits_review: 0,
    cache_hits_learn: 0,
    files_filtered: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
  },
  _seq: { run_id: 0 },
};

const LIMITS = {
  file_review_cache: 1000,
  learn_cache: 500,
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
state.posted_comments ??= {};
state.usage_stats ??= { ...empty.usage_stats };

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

function evictIfOversized(bucket, limit) {
  const obj = state[bucket];
  const keys = Object.keys(obj);
  if (keys.length <= limit) return;
  const sorted = keys
    .map((k) => [k, obj[k].cached_at ?? 0])
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
  flush() { persistNow(); },
};

process.on('beforeExit', persistNow);
