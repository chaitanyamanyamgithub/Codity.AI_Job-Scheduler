import { Pool } from 'pg';
import { Job } from '../types';
import { logger } from '../config/logger';

/**
 * Atomically claims the next eligible job from the given queues.
 *
 * This is the most critical query in the entire system. It does two things simultaneously:
 * 1. Prevents duplicate claims across concurrent workers (FOR UPDATE SKIP LOCKED)
 * 2. Respects each queue's concurrency_limit (serializing via queue-level FOR UPDATE locks to prevent race conditions in Read Committed isolation)
 *
 * Sorting queues by ID before locking prevents deadlocks.
 */
export async function claimNextJob(
  pool: Pool,
  workerId: string,
  queueIds?: string[],
  shardKey?: string,
): Promise<Job | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock the queue rows in a consistent order (by ID) to serialize claims and avoid deadlocks
    let queuesQuery: string;
    let params: unknown[];
    if (queueIds && queueIds.length > 0) {
      queuesQuery = `SELECT id, concurrency_limit, is_paused FROM queues WHERE id = ANY($1) AND ($2::text IS NULL OR shard_key = $2) ORDER BY id FOR UPDATE`;
      params = [queueIds, shardKey || null];
    } else {
      queuesQuery = `SELECT id, concurrency_limit, is_paused FROM queues WHERE ($1::text IS NULL OR shard_key = $1) ORDER BY id FOR UPDATE`;
      params = [shardKey || null];
    }
    const { rows: lockedQueues } = await client.query(queuesQuery, params);

    // 2. Filter queues that are not paused and have capacity
    const eligibleQueueIds: string[] = [];
    for (const q of lockedQueues) {
      if (q.is_paused) continue;

      // Count active (claimed or running) jobs in this queue
      const { rows: [{ count }] } = await client.query(
        `SELECT COUNT(*) as count FROM jobs WHERE queue_id = $1 AND status IN ('claimed', 'running')`,
        [q.id]
      );

      if (parseInt(count, 10) < q.concurrency_limit) {
        eligibleQueueIds.push(q.id);
      }
    }

    if (eligibleQueueIds.length === 0) {
      await client.query('COMMIT');
      return null;
    }

    // 3. Claim the next highest-priority eligible job
    const { rows } = await client.query(
      `UPDATE jobs
       SET status = 'claimed', worker_id = $1, updated_at = now()
       WHERE id = (
         SELECT id FROM jobs
         WHERE queue_id = ANY($2) AND status = 'queued' AND run_at <= now()
         ORDER BY priority DESC, run_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING *`,
      [workerId, eligibleQueueIds]
    );

    const job = (rows[0] as Job) ?? null;

    await client.query('COMMIT');

    if (job) {
      logger.info({ jobId: job.id, workerId, queueId: job.queue_id }, 'Job claimed');
    }

    return job;
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err, workerId }, 'Failed to claim job');
    return null;
  } finally {
    client.release();
  }
}
