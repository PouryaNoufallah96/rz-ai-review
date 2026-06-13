import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import staticPlugin from '@fastify/static';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import healthRoutes from './routes/health.js';
import webhookRoutes from './routes/webhook.js';
import apiRoutes from './routes/api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function buildServer() {
  const app = Fastify({ loggerInstance: logger, bodyLimit: 10 * 1024 * 1024 });
  await app.register(sensible);
  await app.register(staticPlugin, {
    root: path.resolve(__dirname, '../public'),
    prefix: '/',
  });
  await app.register(healthRoutes);
  await app.register(webhookRoutes);
  await app.register(apiRoutes);
  return app;
}

export async function start() {
  const app = await buildServer();
  await app.listen({ port: config.PORT, host: config.HOST });
  logger.info({ port: config.PORT }, 'Server listening');
}
