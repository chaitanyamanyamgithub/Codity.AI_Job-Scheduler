import { Pool } from 'pg';
import cronParser from 'cron-parser';
import { logger } from '../config/logger';
import { acquireDistributedLock, releaseDistributedLock } from './distributedLock';
import { publishEvent } from './events';

/**
 * Scheduler tick — runs on an interval (e.g. every 3s) in the API process.
 * Handles two responsibilities:
 *
 * 1. Flips due 'scheduled' jobs to 'queued' (for delayed/scheduled types)
 * 2. Dispatches due recurring jobs from scheduled_jobs table using cron expressions
 */
export async function schedulerTick(pool: Pool): Promise<void> {
  const ownerId = `scheduler-${process.pid}`;
  const acquired = await acquireDistributedLock(pool, 'scheduler:tick', ownerId, 10_000);
  if (!acquired) {
    return;
  }

  try {
    // 1. Flip due 'scheduled' jobs to 'queued'
    const { rowCount: flippedCount } = await pool.query(
      `UPDATE jobs SET status = 'queued', updated_at = now()
       WHERE status = 'scheduled' AND run_at <= now()`
    );

    if (flippedCount && flippedCount > 0) {
      logger.info({ count: flippedCount }, 'Flipped scheduled jobs to queued');
      await publishEvent(pool, 'scheduler.jobs_released', 'scheduler', null, { count: flippedCount });
    }

    // 2. Dispatch due recurring jobs
    const { rows: dueSchedules } = await pool.query(
      `SELECT * FROM scheduled_jobs WHERE is_active = true AND next_run_at <= now()`
    );

    for (const sj of dueSchedules) {
      try {
        const template = sj.job_template as Record<string, unknown>;

        // Insert a new job from the template
        await pool.query(
          `INSERT INTO jobs (queue_id, type, payload, status, priority, run_at, max_attempts, shard_key)
           SELECT $1, 'recurring', $2, 'queued', $3, now(), $4, q.shard_key
           FROM queues q WHERE q.id = $1`,
          [
            sj.queue_id,
            JSON.stringify(template.payload || {}),
            template.priority || 0,
            template.max_attempts || 3,
          ]
        );

        // Advance from the schedule's previous due time so downtime is caught up one tick at a time.
        const interval = cronParser.parseExpression(sj.cron_expression, {
          currentDate: sj.next_run_at,
        });
        const nextRun = interval.next().toDate();

        await pool.query(
          `UPDATE scheduled_jobs SET last_run_at = now(), next_run_at = $2 WHERE id = $1`,
          [sj.id, nextRun]
        );

        await publishEvent(pool, 'schedule.dispatched', 'scheduled_job', sj.id, {
          queueId: sj.queue_id,
          nextRun,
        });
        logger.info(
          { scheduledJobId: sj.id, queueId: sj.queue_id, nextRun },
          'Dispatched recurring job'
        );
      } catch (err) {
        logger.error({ err, scheduledJobId: sj.id }, 'Failed to dispatch recurring job');
      }
    }
  } catch (err) {
    logger.error({ err }, 'Scheduler tick failed');
  } finally {
    await releaseDistributedLock(pool, 'scheduler:tick', ownerId);
  }
}

/**
 * Starts the scheduler tick loop.
 * Returns a cleanup function to stop the interval.
 */
export function startScheduler(pool: Pool, intervalMs: number): () => void {
  logger.info({ intervalMs }, 'Starting scheduler');

  const timer = setInterval(() => {
    schedulerTick(pool).catch((err) => {
      logger.error({ err }, 'Scheduler tick error');
    });
  }, intervalMs);

  return () => {
    clearInterval(timer);
    logger.info('Scheduler stopped');
  };
}
