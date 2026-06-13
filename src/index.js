import { start } from './server.js';
import { logger } from './lib/logger.js';

start().catch((err) => {
  logger.fatal({ err: err?.message, stack: err?.stack }, 'Server failed to start');
  process.exit(1);
});
