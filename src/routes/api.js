import { runLearn, runReview, runStatus } from '../services/commands.js';
import { store } from '../db/index.js';

const HELP = `Available commands:
  /review <project> <mrIid>   Review (or re-review) a merge request
  /status <project> <mrIid>   Show open vs resolved bot comments
  /learn  <project> <mrIid>   Scan replies and propose guide updates
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

export default async function apiRoutes(app) {
  app.get('/api/stats', async () => store.getStats());

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
      if (cmd === 'status') {
        if (args.length < 2) return { ok: false, message: 'Usage: /status <project> <mrIid>' };
        return await runStatus({ project: args[0], mrIid: args[1] });
      }
      if (cmd === 'learn') {
        if (args.length < 2) return { ok: false, message: 'Usage: /learn <project> <mrIid>' };
        return await runLearn({ project: args[0], mrIid: args[1] });
      }
      return { ok: false, message: `Unknown command: /${cmd}. Try /help.` };
    } catch (err) {
      req.log.error({ err: err?.message, stack: err?.stack }, 'Command failed');
      return reply.code(500).send({ ok: false, message: err?.message ?? String(err) });
    }
  });
}
