/**
 * Parse a unified diff string into hunks with mapping
 * from new-file line numbers back to diff context.
 */
export function parseUnifiedDiff(diff) {
  if (!diff) return [];
  const lines = diff.split('\n');
  const hunks = [];
  let current = null;

  for (const line of lines) {
    const header = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (header) {
      if (current) hunks.push(current);
      current = {
        oldStart: Number(header[1]),
        newStart: Number(header[3]),
        lines: [],
      };
      continue;
    }
    if (!current) continue;
    current.lines.push(line);
  }
  if (current) hunks.push(current);
  return hunks;
}

/**
 * Returns the set of new-file line numbers that are addable as inline comments
 * (added or context lines).
 */
export function commentableLines(diff) {
  const hunks = parseUnifiedDiff(diff);
  const lines = new Set();
  for (const hunk of hunks) {
    let newLine = hunk.newStart;
    for (const l of hunk.lines) {
      if (l.startsWith('-')) continue;
      if (l.startsWith('+') || l.startsWith(' ')) {
        lines.add(newLine);
        newLine += 1;
      }
    }
  }
  return lines;
}
