import { Gitlab } from '@gitbeaker/rest';
import { requireGitLabConfig } from '../config.js';
import { logger } from '../lib/logger.js';

const gitlabConfig = requireGitLabConfig();

export const gitlab = new Gitlab({
  host: gitlabConfig.host,
  token: gitlabConfig.token,
});

const TRANSIENT_ERROR_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusOf(err) {
  return err?.response?.status ?? err?.cause?.response?.status ?? err?.status;
}

function codeOf(err) {
  return err?.cause?.code ?? err?.code ?? err?.name;
}

function isTransientGitLabError(err) {
  if (TRANSIENT_ERROR_CODES.has(codeOf(err))) return true;
  return err instanceof TypeError && err.message === 'fetch failed';
}

function gitLabError({ label, err }) {
  const code = codeOf(err);
  const status = statusOf(err);
  const detail = [
    status ? `status ${status}` : null,
    code ? `code ${code}` : null,
  ]
    .filter(Boolean)
    .join(', ');
  const suffix = detail ? ` (${detail})` : '';
  return new Error(`GitLab request failed during ${label}: ${err.message}${suffix}`, {
    cause: err,
  });
}

async function gitLabRead(label, fn) {
  const maxAttempts = 3;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientGitLabError(err) || attempt === maxAttempts) break;
      await wait(250 * attempt);
    }
  }
  throw gitLabError({ label, err: lastErr });
}

export async function getFileContent({ projectId, filePath, ref }) {
  try {
    const file = await gitLabRead(
      `fetching ${filePath} from ${projectId}@${ref}`,
      () => gitlab.RepositoryFiles.show(projectId, filePath, ref),
    );
    const content = Buffer.from(file.content, 'base64').toString('utf8');
    return { content, sha: file.blob_id };
  } catch (err) {
    if (statusOf(err) === 404 || statusOf(err.cause) === 404) return null;
    throw err;
  }
}

export async function getMergeRequest({ projectId, mrIid }) {
  return gitLabRead(`fetching merge request ${projectId}!${mrIid}`, () =>
    gitlab.MergeRequests.show(projectId, mrIid),
  );
}

export async function getMergeRequestDiff({ projectId, mrIid }) {
  // Returns array of { old_path, new_path, diff, new_file, renamed_file, deleted_file }
  const versions = await gitLabRead(`fetching diffs for ${projectId}!${mrIid}`, () =>
    gitlab.MergeRequests.allDiffs(projectId, mrIid),
  );
  return versions;
}

export async function getMergeRequestVersions({ projectId, mrIid }) {
  return gitLabRead(`fetching diff versions for ${projectId}!${mrIid}`, () =>
    gitlab.MergeRequests.allDiffVersions(projectId, mrIid),
  );
}

export async function listDiscussions({ projectId, mrIid }) {
  return gitLabRead(`fetching discussions for ${projectId}!${mrIid}`, () =>
    gitlab.MergeRequestDiscussions.all(projectId, mrIid),
  );
}

export async function createInlineDiscussion({
  projectId,
  mrIid,
  body,
  position,
}) {
  return gitlab.MergeRequestDiscussions.create(projectId, mrIid, body, {
    position,
  });
}

export async function createGeneralNote({ projectId, mrIid, body }) {
  return gitlab.MergeRequestNotes.create(projectId, mrIid, body);
}

export async function getCurrentUser() {
  return gitLabRead('fetching current GitLab user', () =>
    gitlab.Users.showCurrentUser(),
  );
}

export function buildInlinePosition({ diffRefs, newPath, oldPath, newLine, oldLine }) {
  return {
    base_sha: diffRefs.base_sha,
    head_sha: diffRefs.head_sha,
    start_sha: diffRefs.start_sha,
    position_type: 'text',
    new_path: newPath,
    old_path: oldPath ?? newPath,
    ...(newLine != null ? { new_line: newLine } : {}),
    ...(oldLine != null ? { old_line: oldLine } : {}),
  };
}

export async function safeCreateInlineDiscussion(args) {
  try {
    return await createInlineDiscussion(args);
  } catch (err) {
    logger.warn(
      { err: err?.message, file: args.position?.new_path, line: args.position?.new_line },
      'Inline discussion failed, falling back to general note',
    );
    return createGeneralNote({
      projectId: args.projectId,
      mrIid: args.mrIid,
      body: `**(comment on \`${args.position?.new_path}:${args.position?.new_line}\`)**\n\n${args.body}`,
    });
  }
}
