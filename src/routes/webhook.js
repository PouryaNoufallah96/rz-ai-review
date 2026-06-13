import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import {
  handleMergeRequestEvent,
  handleNoteEvent,
  maybeRereviewOnResolution,
} from '../domain/events.js';

export default async function webhookRoutes(app) {
  if (!config.GITLAB_WEBHOOK_SECRET) {
    logger.warn('GITLAB_WEBHOOK_SECRET not set; webhook route disabled');
    return;
  }
  app.post('/webhooks/gitlab', async (req, reply) => {
    const token = req.headers['x-gitlab-token'];
    if (token !== config.GITLAB_WEBHOOK_SECRET) {
      return reply.code(401).send({ error: 'invalid token' });
    }

    const event = req.headers['x-gitlab-event'];
    const payload = req.body;
    logger.info({ event, action: payload?.object_attributes?.action }, 'Webhook received');

    // Respond fast; process async
    reply.code(202).send({ accepted: true });

    queueMicrotask(async () => {
      try {
        if (event === 'Merge Request Hook') {
          const r1 = await handleMergeRequestEvent(payload);
          logger.info({ r1 }, 'MR event handled');
          const r2 = await maybeRereviewOnResolution(payload);
          logger.info({ r2 }, 'Re-review check');
        } else if (event === 'Note Hook') {
          const r = await handleNoteEvent(payload);
          logger.info({ r }, 'Note event handled');
          const r2 = await maybeRereviewOnResolution(payload);
          logger.info({ r2 }, 'Re-review check');
        }
      } catch (err) {
        logger.error({ err: err?.message, stack: err?.stack }, 'Webhook handler failed');
      }
    });
  });
}
