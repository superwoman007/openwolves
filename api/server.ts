/**
 * local server entry file, for local development
 */
import app from './app.js';
import { logger } from './lib/logger.js';
import { validateEnv } from './lib/env.js';
import { stopTokenCleanup } from './middleware/auth.js';

/**
 * Global error handlers — prevent silent crashes
 */
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { error: String(reason) });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception, shutting down', { error: err.message, stack: err.stack });
  process.exit(1);
});

/**
 * Validate environment before starting
 */
validateEnv();

/**
 * start server with port
 */
const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, () => {
  logger.info(`Server ready on port ${PORT}`, { port: Number(PORT), env: process.env.NODE_ENV ?? 'development' });
});

// Set server-level timeouts
server.requestTimeout = 120_000; // 2 min for normal requests
server.headersTimeout = 65_000;  // slightly above keep-alive

/**
 * Graceful shutdown
 */
import { sseConnections } from './lib/sseTracker.js';

function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`, { activeSSE: sseConnections.size });
  stopTokenCleanup();

  // Notify SSE clients
  for (const res of sseConnections) {
    try {
      res.write(`event: shutdown\ndata: server restarting\n\n`)
      res.end()
    } catch { /* already closed */ }
  }
  sseConnections.clear()

  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
  // Force exit after 10s
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;