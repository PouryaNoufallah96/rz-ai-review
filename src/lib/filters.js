/**
 * Decide whether a changed file should be sent to the AI.
 * Filters out noise that wastes tokens with no review value.
 */

const NOISE_PATH_PATTERNS = [
  /(^|\/)node_modules\//,
  /(^|\/)vendor\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)\.next\//,
  /(^|\/)\.nuxt\//,
  /(^|\/)\.turbo\//,
  /(^|\/)coverage\//,
  /(^|\/)__snapshots__\//,
  /\.min\.(js|css)$/i,
  /\.map$/i,
  /\.lock$/i,
];

const NOISE_FILENAMES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'composer.lock',
  'Pipfile.lock',
  'poetry.lock',
  'Gemfile.lock',
  'Cargo.lock',
  'go.sum',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg',
  '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar',
  '.mp3', '.mp4', '.mov', '.avi', '.wav',
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  '.wasm', '.exe', '.dll', '.so', '.dylib',
]);

const MAX_DIFF_LINES_PER_FILE = 600;

function baseName(p) {
  return p.split('/').pop() ?? p;
}
function extOf(p) {
  const m = p.match(/\.[a-z0-9]+$/i);
  return m ? m[0].toLowerCase() : '';
}

export function classifyFile(d) {
  if (d.deleted_file) return { skip: true, reason: 'deleted' };
  if (d.renamed_file && !d.diff?.trim()) return { skip: true, reason: 'rename-only' };
  if (!d.diff) return { skip: true, reason: 'empty-diff' };

  const path = d.new_path ?? d.old_path ?? '';
  if (NOISE_FILENAMES.has(baseName(path))) return { skip: true, reason: 'lockfile' };
  if (NOISE_PATH_PATTERNS.some((re) => re.test(path))) return { skip: true, reason: 'generated' };
  if (BINARY_EXTENSIONS.has(extOf(path))) return { skip: true, reason: 'binary' };

  const lineCount = (d.diff.match(/\n/g) ?? []).length;
  if (lineCount > MAX_DIFF_LINES_PER_FILE) {
    return { skip: true, reason: `too-large(${lineCount} lines)` };
  }

  return { skip: false };
}

/**
 * Reply heuristic for the learner — saves an AI call when the reply
 * is clearly not teaching a durable rule.
 */
export function isTrivialReply(body) {
  if (!body) return true;
  const t = body.trim();
  if (t.length < 20) return true;
  // strip markdown / emojis / whitespace
  const stripped = t.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\s\W_]+/gu, '');
  if (stripped.length < 12) return true;
  const trivialPatterns = [
    /^(thanks?|thx|ty|ok|okay|sure|fixed|done|got it|noted|agreed|lgtm|👍|👌)\b/i,
    /^(ack(nowledged)?|will (fix|do)|on it)\b/i,
  ];
  return trivialPatterns.some((re) => re.test(t));
}
