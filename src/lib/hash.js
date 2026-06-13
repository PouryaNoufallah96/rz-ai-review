import { createHash } from 'node:crypto';

export function sha256(...parts) {
  const h = createHash('sha256');
  for (const p of parts) h.update(String(p));
  h.update('\0'); // delimiter
  return h.digest('hex');
}
