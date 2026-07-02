import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import cronParser from 'cron-parser';
import { pool } from '../../config/db';
import { authMiddleware } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { createJobSchema } from '../../types';
import { parsePagination, paginationOffset, buildPaginatedResponse } from '../../middleware/pagination';
import { AppError } from '../../middleware/errorHandler';
import { publishEvent } from '../../engine/events';

const router = Router();

router.use(authMiddleware);

async function attachDependencies(jobId: string, dependsOn: string[]): Promise<void> {
  for (const dependencyId of dependsOn) {
    await pool.query(
      `INSERT INTO job_dependencies (job_id, depends_on_job_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [jobId, dependencyId]
    );
  }
}

async function dependenciesAreSatisfied(queueId: string, userId: string, dependsOn: string[]): Promise<boolean> {
  const uniqueDependencyIds = [...new Set(dependsOn)];
  if (uniqueDependencyIds.length === 0) return true;

  const { rows } = await pool.query(
    `SELECT dep.id, dep.status
     FROM queues target_q
     JOIN projects target_p ON target_p.id = target_q.project_id
     JOIN organization_members om ON om.org_id = target_p.org_id
     JOIN jobs dep ON dep.id = ANY($2::uuid[])
     JOIN queues dep_q ON dep_q.id = dep.queue_id
     JOIN projects dep_p ON dep_p.id = dep_q.project_id
     WHERE target_q.id = $1
       AND om.user_id = $3
       AND dep_p.org_id = target_p.org_id`,
    [queueId, uniqueDependencyIds, userId]
  );

  if (rows.length !== uniqueDependencyIds.length) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Every dependency must be an existing job in the same organization');
  }

  return rows.every((row) => row.status === 'completed');
}

function initialJobStatus(type: string, dependenciesSatisfied: boolean): 'blocked' | 'queued' | 'scheduled' {
  if (!dependenciesSatisfied) return 'blocked';
  return type === 'scheduled' ? 'scheduled' : 'queued';
}

/**
 * POST /queues/:queueId/jobs
 * Create a job of any type: immediate, delayed, scheduled, recurring, batch.
 */
router.post('/queues/:queueId/jobs', validate(createJobSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { queueId } = req.params;
    const { type, task_type, payload, priority, max_attempts, idempotency_key, depends_on, callback_url, delay_ms, run_at, cron_expression, batch_jobs } = req.body;
    const taskType = task_type || 'simulated';

    // Verify queue exists and user has access
    const { rows: queueCheck } = await pool.query(
      `SELECT q.id, q.shard_key FROM queues q
       JOIN projects p ON p.id = q.project_id
       JOIN organizations o ON o.id = p.org_id
       JOIN organization_members om ON om.org_id = o.id
       WHERE q.id = $1 AND om.user_id = $2 AND om.role IN ('owner', 'admin', 'operator')`,
      [queueId, req.user!.id]
    );
    if (queueCheck.length === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Queue not found');
    }

    const queue = queueCheck[0];
    const dependencyIds = depends_on || [];
    const dependenciesSatisfied = await dependenciesAreSatisfied(queueId, req.user!.id, dependencyIds);
    const initialStatus = initialJobStatus(type, dependenciesSatisfied);

    switch (type) {
      case 'immediate': {
        const { rows } = await pool.query(
          `INSERT INTO jobs (queue_id, type, task_type, payload, status, priority, run_at, max_attempts, idempotency_key, shard_key)
           VALUES ($1, 'immediate', $2, $3, $4, $5, now(), $6, $7, $8) RETURNING *`,
          [queueId, taskType, JSON.stringify(payload), initialStatus, priority, max_attempts, idempotency_key || null, queue.shard_key]
        );
        await attachDependencies(rows[0].id, dependencyIds);
        await publishEvent(pool, 'job.created', 'job', rows[0].id, rows[0]);
        return res.status(201).json({ data: rows[0] });
      }

      case 'delayed': {
        const runAt = new Date(Date.now() + (delay_ms || 0));
        const { rows } = await pool.query(
          `INSERT INTO jobs (queue_id, type, task_type, payload, status, priority, run_at, max_attempts, idempotency_key, shard_key)
           VALUES ($1, 'delayed', $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [queueId, taskType, JSON.stringify(payload), initialStatus, priority, runAt, max_attempts, idempotency_key || null, queue.shard_key]
        );
        await attachDependencies(rows[0].id, dependencyIds);
        await publishEvent(pool, 'job.created', 'job', rows[0].id, rows[0]);
        return res.status(201).json({ data: rows[0] });
      }

      case 'scheduled': {
        const { rows } = await pool.query(
          `INSERT INTO jobs (queue_id, type, task_type, payload, status, priority, run_at, max_attempts, idempotency_key, shard_key)
           VALUES ($1, 'scheduled', $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [queueId, taskType, JSON.stringify(payload), initialStatus, priority, run_at, max_attempts, idempotency_key || null, queue.shard_key]
        );
        await attachDependencies(rows[0].id, dependencyIds);
        await publishEvent(pool, 'job.created', 'job', rows[0].id, rows[0]);
        return res.status(201).json({ data: rows[0] });
      }

      case 'recurring': {
        if (dependencyIds.length > 0) {
          throw new AppError(400, 'VALIDATION_ERROR', 'Recurring job templates do not support dependencies; attach dependencies to concrete jobs');
        }

        // Validate cron expression
        try {
          cronParser.parseExpression(cron_expression!);
        } catch {
          throw new AppError(400, 'VALIDATION_ERROR', `Invalid cron expression: ${cron_expression}`);
        }

        const interval = cronParser.parseExpression(cron_expression!);
        const nextRun = interval.next().toDate();

        const { rows } = await pool.query(
          `INSERT INTO scheduled_jobs (queue_id, job_template, cron_expression, next_run_at, is_active)
           VALUES ($1, $2, $3, $4, true) RETURNING *`,
          [
            queueId,
            JSON.stringify({ task_type: taskType, payload, priority, max_attempts }),
            cron_expression,
            nextRun,
          ]
        );
        await publishEvent(pool, 'schedule.created', 'scheduled_job', rows[0].id, rows[0]);
        return res.status(201).json({ data: rows[0] });
      }

      case 'batch': {
        const batchId = uuidv4();
        const totalJobs = batch_jobs!.length;

        // Create batch row
        const { rows: batchRows } = await pool.query(
          `INSERT INTO batches (id, queue_id, total_jobs, completed_jobs, failed_jobs, status, callback_url)
           VALUES ($1, $2, $3, 0, 0, 'processing', $4) RETURNING *`,
          [batchId, queueId, totalJobs, callback_url || null]
        );
        const batch = batchRows[0];

        const jobs: unknown[] = [];

        for (const batchJob of batch_jobs!) {
          const { rows } = await pool.query(
            `INSERT INTO jobs (queue_id, type, task_type, payload, status, priority, run_at, max_attempts, idempotency_key, batch_id, shard_key)
             VALUES ($1, 'batch', $2, $3, $4, $5, now(), $6, $7, $8, $9) RETURNING *`,
            [
              queueId,
              batchJob.task_type || taskType,
              JSON.stringify(batchJob.payload),
              initialStatus,
              batchJob.priority || priority,
              batchJob.max_attempts || max_attempts,
              batchJob.idempotency_key || null,
              batchId,
              queue.shard_key,
            ]
          );
          await attachDependencies(rows[0].id, dependencyIds);
          jobs.push(rows[0]);
        }

        await publishEvent(pool, 'batch.created', 'batch', batchId, { batch, jobs });
        return res.status(201).json({ data: { batch, jobs } });
      }

      default:
        throw new AppError(400, 'VALIDATION_ERROR', `Unknown job type: ${type}`);
    }
  } catch (err) {
    // Handle idempotency key conflict
    if ((err as any).code === '23505' && (err as any).constraint?.includes('idempotency')) {
      return next(new AppError(409, 'CONFLICT', 'A job with this idempotency key already exists in this queue'));
    }
    next(err);
  }
});

/**
 * GET /jobs
 * List jobs with filtering and pagination.
 * Filters: status, queue_id, type, batch_id
 */
router.get('/jobs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pagination = parsePagination(req);
    const offset = paginationOffset(pagination);

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    // Always scope to user's queues
    conditions.push(`q_check.user_id = $${paramIdx}`);
    params.push(req.user!.id);
    paramIdx++;

    if (req.query.status) {
      conditions.push(`j.status = $${paramIdx}`);
      params.push(req.query.status);
      paramIdx++;
    }
    if (req.query.queue_id) {
      conditions.push(`j.queue_id = $${paramIdx}`);
      params.push(req.query.queue_id);
      paramIdx++;
    }
    if (req.query.type) {
      conditions.push(`j.type = $${paramIdx}`);
      params.push(req.query.type);
      paramIdx++;
    }
    if (req.query.batch_id) {
      conditions.push(`j.batch_id = $${paramIdx}`);
      params.push(req.query.batch_id);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countQuery = `
      SELECT COUNT(*) as total FROM jobs j
      JOIN queues q ON q.id = j.queue_id
      JOIN projects p ON p.id = q.project_id
      JOIN organization_members q_check ON q_check.org_id = p.org_id
      ${whereClause}`;

    const dataQuery = `
      SELECT j.*, q.name as queue_name FROM jobs j
      JOIN queues q ON q.id = j.queue_id
      JOIN projects p ON p.id = q.project_id
      JOIN organization_members q_check ON q_check.org_id = p.org_id
      ${whereClause}
      ORDER BY j.priority DESC, j.created_at DESC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;

    const { rows: countRows } = await pool.query(countQuery, params);
    const total = parseInt(countRows[0].total, 10);

    const { rows } = await pool.query(dataQuery, [...params, pagination.limit, offset]);
    res.json(buildPaginatedResponse(rows, total, pagination));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /jobs/:id
 * Get job details.
 */
router.get('/jobs/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query(
      `SELECT j.*, q.name as queue_name FROM jobs j
       JOIN queues q ON q.id = j.queue_id
       JOIN projects p ON p.id = q.project_id
       JOIN organizations o ON o.id = p.org_id
       JOIN organization_members om ON om.org_id = o.id
       WHERE j.id = $1 AND om.user_id = $2`,
      [req.params.id, req.user!.id]
    );

    if (rows.length === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Job not found');
    }

    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /jobs/:id/executions
 * Get execution/attempt history for a job.
 */
router.get('/jobs/:id/executions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query(
      `SELECT je.*, w.name as worker_name FROM job_executions je
       JOIN jobs j ON j.id = je.job_id
       JOIN queues q ON q.id = j.queue_id
       JOIN projects p ON p.id = q.project_id
       JOIN organization_members om ON om.org_id = p.org_id
       LEFT JOIN workers w ON w.id = je.worker_id
       WHERE je.job_id = $1 AND om.user_id = $2
       ORDER BY je.attempt_number ASC`,
      [req.params.id, req.user!.id]
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /jobs/:id/logs
 * Get structured logs for a job.
 */
router.get('/jobs/:id/logs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pagination = parsePagination(req);
    const offset = paginationOffset(pagination);

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) as total FROM job_logs jl
       JOIN jobs j ON j.id = jl.job_id
       JOIN queues q ON q.id = j.queue_id
       JOIN projects p ON p.id = q.project_id
       JOIN organization_members om ON om.org_id = p.org_id
       WHERE jl.job_id = $1 AND om.user_id = $2`,
      [req.params.id, req.user!.id]
    );
    const total = parseInt(countRows[0].total, 10);

    const { rows } = await pool.query(
      `SELECT jl.* FROM job_logs jl
       JOIN jobs j ON j.id = jl.job_id
       JOIN queues q ON q.id = j.queue_id
       JOIN projects p ON p.id = q.project_id
       JOIN organization_members om ON om.org_id = p.org_id
       WHERE jl.job_id = $1 AND om.user_id = $4
       ORDER BY jl.created_at ASC
       LIMIT $2 OFFSET $3`,
      [req.params.id, pagination.limit, offset, req.user!.id]
    );

    res.json(buildPaginatedResponse(rows, total, pagination));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /jobs/:id/dependencies
 * Show workflow dependencies for a job.
 */
router.get('/jobs/:id/dependencies', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query(
      `SELECT dep.id, dep.status, dep.type, dep.queue_id, jd.created_at
       FROM job_dependencies jd
       JOIN jobs target ON target.id = jd.job_id
       JOIN jobs dep ON dep.id = jd.depends_on_job_id
       JOIN queues q ON q.id = target.queue_id
       JOIN projects p ON p.id = q.project_id
       JOIN organization_members om ON om.org_id = p.org_id
       WHERE jd.job_id = $1 AND om.user_id = $2
       ORDER BY jd.created_at ASC`,
      [req.params.id, req.user!.id]
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /jobs/:id/retry
 * Manually retry a failed or dead_letter job.
 */
router.post('/jobs/:id/retry', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows: jobRows } = await pool.query(
      `SELECT j.* FROM jobs j
       JOIN queues q ON q.id = j.queue_id
       JOIN projects p ON p.id = q.project_id
       JOIN organizations o ON o.id = p.org_id
       JOIN organization_members om ON om.org_id = o.id
       WHERE j.id = $1 AND om.user_id = $2 AND om.role IN ('owner', 'admin', 'operator')`,
      [req.params.id, req.user!.id]
    );

    if (jobRows.length === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Job not found');
    }

    const job = jobRows[0];
    if (!['failed', 'dead_letter'].includes(job.status)) {
      throw new AppError(400, 'BAD_REQUEST', `Cannot retry a job with status '${job.status}'`);
    }

    // Reset job for retry
    const { rows } = await pool.query(
      `UPDATE jobs SET status = 'queued', worker_id = NULL, run_at = now(),
       attempts = 0, updated_at = now() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );

    // Log the manual retry
    await pool.query(
      `INSERT INTO job_logs (job_id, level, message) VALUES ($1, 'info', 'Manual retry triggered')`,
      [req.params.id]
    );

    await publishEvent(pool, 'job.retry_requested', 'job', rows[0].id, rows[0]);
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

export default router;
