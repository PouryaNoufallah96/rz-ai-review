import { Gitlab } from '@gitbeaker/rest';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

export const gitlab = new Gitlab({
  host: config.GITLAB_HOST,
  token: config.GITLAB_TOKEN,
});

export async function getFileContent({ projectId, filePath, ref }) {
  try {
    const file = await gitlab.RepositoryFiles.show(projectId, filePath, ref);
    const content = Buffer.from(file.content, 'base64').toString('utf8');
    return { content, sha: file.blob_id };
  } catch (err) {
    if (err?.cause?.response?.status === 404) return null;
    throw err;
  }
}

export async function getMergeRequest({ projectId, mrIid }) {
  return gitlab.MergeRequests.show(projectId, mrIid);
}

export async function getMergeRequestDiff({ projectId, mrIid }) {
  // Returns array of { old_path, new_path, diff, new_file, renamed_file, deleted_file }
  const versions = await gitlab.MergeRequests.allDiffs(projectId, mrIid);
  return versions;
}

export async function getMergeRequestVersions({ projectId, mrIid }) {
  return gitlab.MergeRequests.allDiffVersions(projectId, mrIid);
}

export async function listDiscussions({ projectId, mrIid }) {
  return gitlab.MergeRequestDiscussions.all(projectId, mrIid);
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
  return gitlab.Users.showCurrentUser();
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
