import { Pool } from 'pg';
import { Job, RetryPolicy } from '../types';
import { computeRetryDelayMs, getDefaultRetryPolicy } from './retryPolicy';
import { logger } from '../config/logger';
import { acquireDistributedLock, releaseDistributedLock } from './distributedLock';
import { generateFailureSummary } from './failureSummary';
import { publishEvent } from './events';

/**
 * Executes a claimed job through its full lifecycle. A database-backed lock is
 * used as a second line of defense against duplicate execution.
 */
export async function executeJob(pool: Pool, job: Job, workerId: string): Promise<void> {
  const attemptNumber = job.attempts + 1;
  const lockKey = `job:${job.id}`;
  const lockAcquired = await acquireDistributedLock(pool, lockKey, workerId, 10 * 60 * 1000);

  if (!lockAcquired) {
    logger.warn({ jobId: job.id, workerId }, 'Job execution skipped because distributed lock is held');
    return;
  }

  try {
    await pool.query(
      `UPDATE jobs SET status = 'running', attempts = $2, updated_at = now() WHERE id = $1`,
      [job.id, attemptNumber]
    );
    await publishEvent(pool, 'job.running', 'job', job.id, { jobId: job.id, workerId, attemptNumber });

    const { rows: [execution] } = await pool.query(
      `INSERT INTO job_executions (job_id, worker_id, attempt_number, status)
       VALUES ($1, $2, $3, 'running') RETURNING id`,
      [job.id, workerId, attemptNumber]
    );

    await insertJobLog(pool, job.id, 'info', `Attempt ${attemptNumber} started by worker ${workerId}`);

    try {
      const result = await runJobHandler(job);

      await pool.query(
        `UPDATE jobs SET status = 'completed', result_data = $2, updated_at = now() WHERE id = $1`,
        [job.id, JSON.stringify(result)]
      );

      await pool.query(
        `UPDATE job_executions SET status = 'completed', finished_at = now(), result = $2 WHERE id = $1`,
        [execution.id, JSON.stringify(result)]
      );

      await insertJobLog(pool, job.id, 'info', `Attempt ${attemptNumber} completed successfully`);
      await publishEvent(pool, 'job.completed', 'job', job.id, { jobId: job.id, workerId, attemptNumber });
      await unblockDependentJobs(pool, job.id);
      if (job.batch_id) {
        await updateBatchProgress(pool, job.batch_id, 'completed');
      }
      logger.info({ jobId: job.id, attemptNumber, workerId }, 'Job completed');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      await pool.query(
        `UPDATE job_executions SET status = 'failed', finished_at = now(), error_message = $2 WHERE id = $1`,
        [execution.id, errorMessage]
      );

      await insertJobLog(pool, job.id, 'error', `Attempt ${attemptNumber} failed: ${errorMessage}`);

      const retryPolicy = await getRetryPolicyForQueue(pool, job.queue_id);
      const maxAttempts = job.max_attempts || retryPolicy.max_retries;

      if (attemptNumber < maxAttempts) {
        const delay = computeRetryDelayMs(retryPolicy, attemptNumber);
        await pool.query(
          `UPDATE jobs
           SET status = 'queued',
               worker_id = NULL,
               run_at = now() + make_interval(secs => $2::double precision / 1000),
               updated_at = now()
           WHERE id = $1`,
          [job.id, delay]
        );

        await insertJobLog(
          pool,
          job.id,
          'info',
          `Scheduled retry ${attemptNumber + 1}/${maxAttempts} in ${delay}ms (${retryPolicy.strategy})`,
        );
        await publishEvent(pool, 'job.retry_scheduled', 'job', job.id, { jobId: job.id, attemptNumber, delay });
        logger.info({ jobId: job.id, attemptNumber, delay, strategy: retryPolicy.strategy }, 'Job scheduled for retry');
      } else {
        const failureSummary = generateFailureSummary(errorMessage, {
          jobType: job.type,
          attempts: attemptNumber,
        });

        await pool.query(
          `UPDATE jobs SET status = 'dead_letter', failure_summary = $2, updated_at = now() WHERE id = $1`,
          [job.id, failureSummary]
        );

        await pool.query(
          `INSERT INTO dead_letter_queue (original_job_id, queue_id, payload, failure_reason, attempts_made, failure_summary)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [job.id, job.queue_id, JSON.stringify(job.payload), errorMessage, attemptNumber, failureSummary]
        );

        await insertJobLog(pool, job.id, 'error', `Moved to dead letter queue after ${attemptNumber} failed attempts`);
        await insertJobLog(pool, job.id, 'warn', `Failure summary: ${failureSummary}`);
        await publishEvent(pool, 'job.dead_lettered', 'job', job.id, { jobId: job.id, failureSummary });
        if (job.batch_id) {
          await updateBatchProgress(pool, job.batch_id, 'failed');
        }
        logger.warn({ jobId: job.id, attemptNumber }, 'Job moved to dead letter queue');
      }
    }
  } finally {
    await releaseDistributedLock(pool, lockKey, workerId);
  }
}

import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

async function runJobHandler(job: Job): Promise<Record<string, unknown>> {
  const taskType = job.task_type || 'simulated';
  const payload = (job.payload || {}) as Record<string, unknown>;

  switch (taskType) {
    case 'http': {
      const url = payload.url as string;
      if (!url) throw new Error('HTTP task requires a "url" in payload');
      const method = (payload.method as string) || 'GET';
      const headers = (payload.headers as Record<string, string>) || {};
      const timeoutMs = (payload.timeout_ms as number) || 10000;
      const expectedStatus = (payload.expected_status as number) || 200;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          method,
          headers,
          body: ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase()) ? JSON.stringify(payload.body ?? {}) : undefined,
          signal: controller.signal,
        });

        const responseText = await response.text();
        let responseJson: unknown = null;
        try {
          responseJson = JSON.parse(responseText);
        } catch {
          responseJson = responseText;
        }

        if (expectedStatus && response.status !== expectedStatus && (response.status < 200 || response.status >= 300)) {
          throw new Error(`HTTP request failed with status ${response.status}: ${responseText.slice(0, 200)}`);
        }

        return {
          task_type: 'http',
          url,
          method,
          status: response.status,
          response: responseJson,
        };
      } finally {
        clearTimeout(timer);
      }
    }

    case 'shell': {
      const command = payload.command as string;
      if (!command) throw new Error('Shell task requires a "command" in payload');
      const timeoutMs = (payload.timeout_ms as number) || 10000;
      const cwd = (payload.cwd as string) || process.cwd();

      try {
        const { stdout, stderr } = await execAsync(command, { timeout: timeoutMs, cwd });
        return {
          task_type: 'shell',
          command,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exit_code: 0,
        };
      } catch (err: any) {
        throw new Error(`Shell command failed (exit code ${err.code ?? 'unknown'}): ${err.stderr || err.message}`);
      }
    }

    case 'simulated':
    default: {
      const simulatedDurationMs = (payload.duration_ms as number) || randomBetween(100, 2000);
      const failureRate = (payload.failure_rate as number) ?? 0.1;

      await sleep(simulatedDurationMs);

      if (payload.should_fail === true || Math.random() < failureRate) {
        throw new Error(
          (payload.error_message as string) || `Simulated failure (rate: ${failureRate})`,
        );
      }

      return {
        task_type: 'simulated',
        processed_at: new Date().toISOString(),
        duration_ms: simulatedDurationMs,
        input: payload,
      };
    }
  }
}

async function updateBatchProgress(pool: Pool, batchId: string, resultStatus: 'completed' | 'failed'): Promise<void> {
  const isSuccess = resultStatus === 'completed';
  const { rows } = await pool.query(
    `UPDATE batches
     SET completed_jobs = completed_jobs + $2,
         failed_jobs = failed_jobs + $3,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [batchId, isSuccess ? 1 : 0, isSuccess ? 0 : 1]
  );

  if (rows.length === 0) return;
  const batch = rows[0];

  if (batch.completed_jobs + batch.failed_jobs >= batch.total_jobs) {
    const finalStatus = batch.failed_jobs > 0 ? 'failed' : 'completed';
    await pool.query(
      `UPDATE batches SET status = $2, updated_at = now() WHERE id = $1`,
      [batchId, finalStatus]
    );

    batch.status = finalStatus;
    await publishEvent(pool, 'batch.completed', 'batch', batchId, batch);
    logger.info({ batchId, finalStatus, total: batch.total_jobs }, 'Batch execution completed');

    if (batch.callback_url) {
      try {
        await fetch(batch.callback_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'batch.completed',
            batch_id: batchId,
            status: finalStatus,
            total_jobs: batch.total_jobs,
            completed_jobs: batch.completed_jobs,
            failed_jobs: batch.failed_jobs,
          }),
        });
        logger.info({ batchId, callbackUrl: batch.callback_url }, 'Batch completion callback triggered');
      } catch (err) {
        logger.error({ err, batchId, callbackUrl: batch.callback_url }, 'Failed to trigger batch completion callback');
      }
    }
  }
}

async function getRetryPolicyForQueue(pool: Pool, queueId: string): Promise<RetryPolicy> {
  const { rows } = await pool.query(
    `SELECT rp.* FROM retry_policies rp
     JOIN queues q ON q.retry_policy_id = rp.id
     WHERE q.id = $1`,
    [queueId]
  );

  if (rows.length > 0) {
    return rows[0] as RetryPolicy;
  }

  return getDefaultRetryPolicy();
}

async function unblockDependentJobs(pool: Pool, completedJobId: string): Promise<void> {
  const { rows } = await pool.query(
    `UPDATE jobs j
     SET status = CASE WHEN j.run_at <= now() THEN 'queued' ELSE 'scheduled' END,
         updated_at = now()
     WHERE j.status = 'blocked'
       AND j.id IN (
         SELECT jd.job_id
         FROM job_dependencies jd
         WHERE jd.depends_on_job_id = $1
       )
       AND NOT EXISTS (
         SELECT 1
         FROM job_dependencies pending
         JOIN jobs dep ON dep.id = pending.depends_on_job_id
         WHERE pending.job_id = j.id
           AND dep.status <> 'completed'
       )
     RETURNING j.*`,
    [completedJobId]
  );

  for (const releasedJob of rows) {
    await insertJobLog(pool, releasedJob.id, 'info', 'Workflow dependencies satisfied; job released');
    await publishEvent(pool, 'job.dependencies_satisfied', 'job', releasedJob.id, releasedJob);
  }
}

async function insertJobLog(
  pool: Pool,
  jobId: string,
  level: 'info' | 'warn' | 'error',
  message: string,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO job_logs (job_id, level, message) VALUES ($1, $2, $3)`,
      [jobId, level, message]
    );
  } catch (err) {
    logger.error({ err, jobId }, 'Failed to insert job log');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
