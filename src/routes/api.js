import {
  runLearn,
  runLocalReview,
  runRefreshReview,
  runReview,
  runSetupReview,
  runStatus,
} from '../services/commands.js';
import { store } from '../db/index.js';

const HELP = `Available commands:
  /review <project> <mrIid>   Review (or re-review) a merge request
  /review-local <path> [base] Review a local diff without GitLab
  /status <project> <mrIid>   Show open vs resolved bot comments
  /learn  <project> <mrIid>   Scan replies and propose guide updates
  /setup-review <path> [--local]   Create shared review docs in a target project
  /refresh-review <path> [--local] Refresh generated review docs in a target project
  /help                       Show this message

<project> can be a numeric ID or a path like group/subgroup/repo.`;

function parse(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) {
    return { cmd: null, args: [], raw: trimmed };
  }
  const [cmd, ...args] = trimmed.split(/\s+/);
  return { cmd: cmd.slice(1).toLowerCase(), args, raw: trimmed };
}

function localOnlyFromArgs(args) {
  return args.includes('--local') || args.includes('--private');
}

function hasUnknownSetupFlags(args) {
  return args.slice(1).some((arg) => arg.startsWith('-') && !['--local', '--private'].includes(arg));
}

export default async function apiRoutes(app) {
  app.get('/api/stats', async () => ({
    ...store.getStats(),
    // Review-quality metrics for tuning (counters only; local-only, RZ-57).
    reviewQuality: store.getReviewMetrics(),
  }));

  app.post('/api/command', async (req, reply) => {
    const text = req.body?.text ?? '';
    const { cmd, args } = parse(text);

    if (!cmd || cmd === 'help' || cmd === 'start') {
      return { ok: true, kind: 'help', message: HELP };
    }

    try {
      if (cmd === 'review') {
        if (args.length < 2) return { ok: false, message: 'Usage: /review <project> <mrIid>' };
        return await runReview({ project: args[0], mrIid: args[1] });
      }
      if (cmd === 'review-local') {
        if (args.length < 1) return { ok: false, message: 'Usage: /review-local <path> [base]' };
        return await runLocalReview({ targetPath: args[0], base: args[1] });
      }
      if (cmd === 'status') {
        if (args.length < 2) return { ok: false, message: 'Usage: /status <project> <mrIid>' };
        return await runStatus({ project: args[0], mrIid: args[1] });
      }
      if (cmd === 'learn') {
        if (args.length < 2) return { ok: false, message: 'Usage: /learn <project> <mrIid>' };
        return await runLearn({ project: args[0], mrIid: args[1] });
      }
      if (cmd === 'setup-review') {
        if (args.length < 1) return { ok: false, message: 'Usage: /setup-review <path> [--local]' };
        if (hasUnknownSetupFlags(args)) return { ok: false, message: 'Unknown setup-review option' };
        return runSetupReview({ targetPath: args[0], localOnly: localOnlyFromArgs(args) });
      }
      if (cmd === 'refresh-review') {
        if (args.length < 1) return { ok: false, message: 'Usage: /refresh-review <path> [--local]' };
        if (hasUnknownSetupFlags(args)) return { ok: false, message: 'Unknown refresh-review option' };
        return runRefreshReview({ targetPath: args[0], localOnly: localOnlyFromArgs(args) });
      }
      return { ok: false, message: `Unknown command: /${cmd}. Try /help.` };
    } catch (err) {
      req.log.error({ err: err?.message, stack: err?.stack }, 'Command failed');
      return reply.code(500).send({ ok: false, message: err?.message ?? String(err) });
    }
  });
}
