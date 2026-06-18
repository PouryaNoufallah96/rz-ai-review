import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from '../lib/hash.js';

// Project Index Checkpoint: the Target Project owned, metadata-only file that
// lets Project Knowledge update incrementally (CONTEXT.md "Project Index
// Checkpoint"; ADR 0003). It is SAFE to commit because it stores only file
// hashes, classifications, affected contexts, and generated-doc fingerprints —
// never source content, AI summaries, secrets, or merge request discussion IDs.
//
// Determinism is a hard requirement: no wall-clock timestamps or other
// nondeterministic fields, and all object keys / arrays are sorted so that
// running setup or refresh twice on an unchanged repo yields a byte-identical
// file.

export const CHECKPOINT_DIR = '.rz-review';
export const CHECKPOINT_FILE = '.rz-review/checkpoint.json';

const TEST_PATH_RE = /(^|\/)(tests?|__tests__|spec)(\/|$)|\.(test|spec)\.[a-z]+$/i;

// Machine-local artifacts that must not enter a committable, cross-machine
// checkpoint (ADR 0003: refresh should stay incremental across machines).
const IGNORED_BASENAMES = new Set(['.DS_Store', 'Thumbs.db', '.env']);
const IGNORED_EXT = new Set(['.log']);

// Drop machine-local / non-committable files so the checkpoint stays stable
// across machines and matches what a Target Project would actually version.
export function isCheckpointTrackable(relPath) {
  const base = path.basename(relPath);
  if (IGNORED_BASENAMES.has(base)) return false;
  if (base.startsWith('.env.') && base !== '.env.example') return false;
  if (IGNORED_EXT.has(path.extname(relPath).toLowerCase())) return false;
  return true;
}

const CONFIG_BASENAMES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'bun.lock',
  'tsconfig.json',
  'jsconfig.json',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  '.npmrc',
  '.nvmrc',
  '.env.example',
  'dockerfile',
  '.dockerignore',
  '.gitlab-ci.yml',
]);

const CONFIG_EXTS = new Set([
  '.json',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.conf',
  '.config',
  '.lock',
]);

const DOC_EXTS = new Set(['.md', '.mdx', '.markdown', '.txt', '.rst', '.adoc']);

const SOURCE_EXTS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.vue',
  '.svelte',
  '.cs',
  '.go',
  '.py',
  '.php',
  '.java',
  '.kt',
  '.rs',
  '.rb',
  '.css',
  '.scss',
  '.html',
]);

const ASSET_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp4',
  '.webm',
  '.mp3',
  '.wav',
  '.pdf',
]);

export function classifyFile(relPath) {
  const base = path.basename(relPath).toLowerCase();
  const ext = path.extname(relPath).toLowerCase();

  if (TEST_PATH_RE.test(relPath)) return 'test';
  if (CONFIG_BASENAMES.has(base) || base.startsWith('.env')) return 'config';
  if (DOC_EXTS.has(ext)) return 'doc';
  if (CONFIG_EXTS.has(ext)) return 'config';
  if (SOURCE_EXTS.has(ext)) return 'source';
  if (ASSET_EXTS.has(ext)) return 'asset';
  return 'other';
}

function hashFileContents(filePath) {
  try {
    return sha256(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// Build the deterministic { <rel>: { classification, hash } } map from a list of
// relative paths, applying the same trackable rules as the checkpoint. Shared by
// the checkpoint writer and refresh so current-tree hashes are computed exactly
// once and stay consistent with what gets persisted.
export function buildFilesMap(root, files) {
  const map = {};
  for (const rel of [...new Set(files)].sort()) {
    if (!isCheckpointTrackable(rel)) continue;
    const hash = hashFileContents(path.join(root, rel));
    if (hash === null) continue;
    map[rel] = { classification: classifyFile(rel), hash };
  }
  return map;
}

// Safe parse of a prior checkpoint. Returns the parsed object or null; never
// throws (missing file, unparseable JSON, or unreadable path all yield null) so
// refresh can treat "no usable prior checkpoint" as a full pass.
export function readCheckpoint(root) {
  try {
    const raw = fs.readFileSync(path.join(root, CHECKPOINT_FILE), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

// Pure, deterministic diff of a prior checkpoint's files map against the current
// tree's files map (both shaped { <rel>: { hash } }). Returns sorted arrays of
// relative paths: added (new), changed (hash differs), removed (gone), and
// unchanged (hash identical). Tolerates a null/empty prior checkpoint by
// treating every current file as added.
export function diffCheckpoint(prev, currentFiles) {
  const prevFiles = prev && typeof prev === 'object' && prev.files ? prev.files : {};
  const current = currentFiles ?? {};

  const added = [];
  const changed = [];
  const unchanged = [];
  const removed = [];

  for (const rel of Object.keys(current).sort()) {
    const before = prevFiles[rel];
    if (!before) {
      added.push(rel);
    } else if (before.hash !== current[rel].hash) {
      changed.push(rel);
    } else {
      unchanged.push(rel);
    }
  }

  for (const rel of Object.keys(prevFiles).sort()) {
    if (!(rel in current)) removed.push(rel);
  }

  return { added, changed, removed, unchanged };
}

// Build the deterministic checkpoint object. Inputs:
// - root: absolute Target Project root
// - files: relative file paths (any order; sorted here)
// - contexts: affected/relevant context doc ids
// - generatedDocFingerprints: map of relPath -> sha256 of the generated block
function buildCheckpoint({ files, root, contexts, generatedDocFingerprints }) {
  const sortedFiles = buildFilesMap(root, files);

  const generatedDocs = {};
  for (const rel of Object.keys(generatedDocFingerprints).sort()) {
    generatedDocs[rel] = generatedDocFingerprints[rel];
  }

  return {
    version: 1,
    contexts: [...new Set(contexts)].sort(),
    files: sortedFiles,
    generatedDocs,
  };
}

export function writeCheckpoint(root, input) {
  const relPath = CHECKPOINT_FILE;
  const dirPath = path.join(root, CHECKPOINT_DIR);
  fs.mkdirSync(dirPath, { recursive: true });

  const checkpoint = buildCheckpoint({ root, ...input });
  const next = `${JSON.stringify(checkpoint, null, 2)}\n`;
  const filePath = path.join(root, relPath);

  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  if (existing === next) return { path: relPath, status: 'unchanged' };
  fs.writeFileSync(filePath, next);
  return { path: relPath, status: existing ? 'updated' : 'created' };
}
