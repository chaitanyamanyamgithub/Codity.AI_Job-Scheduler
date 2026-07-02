import app from './app';
import { env } from './config/env';
import { checkDatabaseConnection, pool } from './config/db';
import { logger } from './config/logger';
import { runMigrations } from './db/migrate';
import { startScheduler } from './engine/scheduler';
import { attachWebSocketHub } from './realtime/websocketHub';

async function startServer() {
  try {
    // 1. Verify DB connection
    await checkDatabaseConnection();

    // 2. Run migrations if configured
    if (env.RUN_MIGRATIONS) {
      logger.info('Running database migrations...');
      await runMigrations();
    }

    // 3. Start scheduler loop
    const stopScheduler = startScheduler(pool, env.SCHEDULER_TICK_INTERVAL_MS);

    // 4. Start HTTP server
    const server = app.listen(env.PORT, () => {
      logger.info({ port: env.PORT, env: env.NODE_ENV }, 'API server started');
    });
    attachWebSocketHub(server);

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down API server...');
      stopScheduler();
      server.close(async () => {
        logger.info('HTTP server closed, closing database pool...');
        await pool.end();
        logger.info('Database pool closed, exit');
        process.exit(0);
      });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (err) {
    logger.error({ err }, 'Failed to start API server');
    process.exit(1);
  }
}

startServer();
