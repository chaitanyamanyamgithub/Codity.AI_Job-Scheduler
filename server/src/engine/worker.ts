import { Pool, PoolClient } from 'pg';
import { claimNextJob } from './claimer';
import { executeJob } from './executor';
import { logger } from '../config/logger';
import { env } from '../config/env';

/**
 * Simple in-process concurrency limiter.
 * Bounds the number of concurrent async operations.
 */
function createLimiter(concurrency: number) {
  let running = 0;
  const queue: Array<() => void> = [];

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        running++;
        fn()
          .then(resolve, reject)
          .finally(() => {
            running--;
            if (queue.length > 0) {
              const next = queue.shift();
              if (next) next();
            }
          });
      };

      if (running < concurrency) {
        run();
      } else {
        queue.push(run);
      }
    });
  };
}

/**
 * Worker process — polls for jobs, executes them concurrently, sends heartbeats,
 * and supports graceful shutdown.
 */
export class WorkerProcess {
  private workerId: string = '';
  private shuttingDown = false;
  private inFlight = 0;
  private limit: ReturnType<typeof createLimiter>;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private wakePoll: (() => void) | null = null;
  private eventClient: PoolClient | null = null;

  constructor(
    private pool: Pool,
    private workerName: string = env.WORKER_NAME,
    private maxParallelJobs: number = env.WORKER_MAX_PARALLEL_JOBS,
    private pollIntervalMs: number = env.WORKER_POLL_INTERVAL_MS,
  ) {
    this.limit = createLimiter(maxParallelJobs);
  }

  /**
   * Registers the worker in the database and starts polling + heartbeats.
   */
  async start(): Promise<void> {
    // Register worker
    const { rows } = await this.pool.query(
      `INSERT INTO workers (name, status, last_heartbeat_at)
       VALUES ($1, 'idle', now()) RETURNING id`,
      [this.workerName]
    );
    this.workerId = rows[0].id;
    logger.info({ workerId: this.workerId, name: this.workerName, maxParallelJobs: this.maxParallelJobs },
      'Worker registered');

    // Start heartbeat
    this.startHeartbeat();
    await this.startEventListener();

    // Start poll loop
    this.pollLoop();

    // Handle graceful shutdown
    process.on('SIGTERM', () => this.gracefulShutdown());
    process.on('SIGINT', () => this.gracefulShutdown());
  }

  /**
   * Main poll loop — continuously tries to claim and execute jobs.
   */
  private async pollLoop(): Promise<void> {
    while (!this.shuttingDown) {
      try {
        if (this.inFlight < this.maxParallelJobs) {
          const job = await claimNextJob(this.pool, this.workerId, undefined, env.WORKER_SHARD_KEY);

          if (job) {
            this.inFlight++;
            // Execute within concurrency limit
            this.limit(async () => {
              try {
                await executeJob(this.pool, job, this.workerId);
              } catch (err) {
                logger.error({ err, jobId: job.id }, 'Uncaught error in job execution');
              } finally {
                this.inFlight--;
              }
            });

            // Immediately try to claim more, up to the limit
            continue;
          }
        }
      } catch (err) {
        logger.error({ err }, 'Error in poll loop');
      }

      // No job available or at capacity — brief backoff before polling again
      await this.sleep(this.pollIntervalMs);
    }
  }

  /**
   * Sends periodic heartbeats to the database.
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(async () => {
      try {
        const status = this.inFlight > 0 ? 'busy' : 'idle';
        await this.pool.query(
          `UPDATE workers SET last_heartbeat_at = now(), status = $2 WHERE id = $1`,
          [this.workerId, status]
        );
        await this.pool.query(
          `INSERT INTO worker_heartbeats (worker_id, active_job_count) VALUES ($1, $2)`,
          [this.workerId, this.inFlight]
        );
      } catch (err) {
        logger.error({ err, workerId: this.workerId }, 'Failed to send heartbeat');
      }
    }, env.WORKER_HEARTBEAT_INTERVAL_MS);
  }

  async startEventListener(): Promise<void> {
    const client = await this.pool.connect();
    this.eventClient = client;
    await client.query('LISTEN scheduler_events');
    client.on('notification', () => {
      if (this.wakePoll) {
        this.wakePoll();
        this.wakePoll = null;
      }
    });
    client.on('error', (err) => {
      logger.error({ err, workerId: this.workerId }, 'Worker event listener failed');
      this.eventClient = null;
      client.release();
    });
    logger.info({ workerId: this.workerId, shardKey: env.WORKER_SHARD_KEY }, 'Worker listening for job events');
  }

  /**
   * Gracefully shuts down: stops accepting new jobs, waits for in-flight
   * jobs to complete, marks worker as offline.
   */
  private async gracefulShutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    logger.info({ workerId: this.workerId, inFlight: this.inFlight },
      'Shutdown signal received, waiting for in-flight jobs to finish...');

    // Stop heartbeat
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.eventClient) {
      try {
        await this.eventClient.query('UNLISTEN scheduler_events');
      } catch (err) {
        logger.warn({ err, workerId: this.workerId }, 'Failed to unlisten worker event channel');
      } finally {
        this.eventClient.release();
        this.eventClient = null;
      }
    }

    // Wait for in-flight jobs
    const maxWaitMs = env.WORKER_SHUTDOWN_TIMEOUT_MS;
    const startTime = Date.now();
    while (this.inFlight > 0 && Date.now() - startTime < maxWaitMs) {
      await this.sleep(200);
    }

    if (this.inFlight > 0) {
      logger.warn({ inFlight: this.inFlight },
        'Timed out waiting for in-flight jobs, shutting down anyway');
    }

    // Mark worker as offline
    try {
      await this.pool.query(
        `UPDATE workers SET status = 'offline', last_heartbeat_at = now() WHERE id = $1`,
        [this.workerId]
      );
    } catch (err) {
      logger.error({ err }, 'Failed to mark worker as offline');
    }

    logger.info({ workerId: this.workerId }, 'Worker shutdown complete');
    process.exit(0);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.wakePoll = () => {
        if (this.pollTimer) {
          clearTimeout(this.pollTimer);
          this.pollTimer = null;
        }
        resolve();
      };
      this.pollTimer = setTimeout(() => {
        this.wakePoll = null;
        this.pollTimer = null;
        resolve();
      }, ms);
    });
  }
}
