import { store } from '../db/index.js';
import { config } from '../config.js';
import { getFileContent } from './gitlab.js';
import { logger } from '../lib/logger.js';

/**
 * Fetch REVIEW_GUIDE.md from project default branch (or a given ref).
 * Returns null if the file does not exist.
 * Cached in SQLite keyed on project_id + blob sha.
 */
export async function loadGuide({ projectId, ref }) {
  const remote = await getFileContent({
    projectId,
    filePath: config.REVIEW_GUIDE_PATH,
    ref,
  });

  if (!remote) {
    logger.info({ projectId }, 'No REVIEW_GUIDE.md present; skipping review');
    return null;
  }

  const cached = store.getGuide(projectId);
  if (cached?.file_sha === remote.sha) {
    return { content: cached.content, sha: remote.sha, fromCache: true };
  }

  store.upsertGuide({ projectId, fileSha: remote.sha, content: remote.content });
  return { content: remote.content, sha: remote.sha, fromCache: false };
}
