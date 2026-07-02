import { pool, checkDatabaseConnection } from './config/db';
import { logger } from './config/logger';
import { WorkerProcess } from './engine/worker';
import { env } from './config/env';

async function startWorker() {
  try {
    logger.info('Starting worker process...');
    // 1. Verify DB connection
    await checkDatabaseConnection();

    // 2. Instantiate and start worker process
    const worker = new WorkerProcess(
      pool,
      env.WORKER_NAME,
      env.WORKER_MAX_PARALLEL_JOBS,
      env.WORKER_POLL_INTERVAL_MS
    );

    await worker.start();
  } catch (err) {
    logger.error({ err }, 'Failed to start worker process');
    process.exit(1);
  }
}

startWorker();
