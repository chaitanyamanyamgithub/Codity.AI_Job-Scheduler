import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../../config/db';
import { authMiddleware } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { createQueueSchema, updateQueueSchema } from '../../types';
import { parsePagination, paginationOffset, buildPaginatedResponse } from '../../middleware/pagination';
import { AppError } from '../../middleware/errorHandler';
import { publishEvent } from '../../engine/events';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

/**
 * POST /projects/:projectId/queues
 * Create a new queue within a project.
 */
router.post('/projects/:projectId/queues', validate(createQueueSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId } = req.params;
    const { name, priority, concurrency_limit, retry_policy_id, shard_key } = req.body;

    // Verify project ownership
    const { rows: project } = await pool.query(
      `SELECT p.id FROM projects p
       JOIN organizations o ON o.id = p.org_id
       JOIN organization_members om ON om.org_id = o.id
       WHERE p.id = $1 AND om.user_id = $2 AND om.role IN ('owner', 'admin', 'operator')`,
      [projectId, req.user!.id]
    );
    if (project.length === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Project not found');
    }

    // Create queue
    const { rows } = await pool.query(
      `INSERT INTO queues (project_id, name, priority, concurrency_limit, retry_policy_id, shard_key)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [projectId, name, priority || 0, concurrency_limit || 5, retry_policy_id || null, shard_key || 'default']
    );

    await publishEvent(pool, 'queue.created', 'queue', rows[0].id, rows[0]);
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    if ((err as any).code === '23505') {
      return next(new AppError(409, 'CONFLICT', 'A queue with this name already exists in the project'));
    }
    next(err);
  }
});

/**
 * GET /queues
 * List all queues (optionally filter by project_id).
 */
router.get('/queues', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pagination = parsePagination(req);
    const offset = paginationOffset(pagination);
    const projectId = req.query.project_id as string | undefined;

    let countQuery: string;
    let dataQuery: string;
    let params: unknown[];

    if (projectId) {
      countQuery = `
        SELECT COUNT(*) as total FROM queues q
        JOIN projects p ON p.id = q.project_id
        JOIN organizations o ON o.id = p.org_id
        JOIN organization_members om ON om.org_id = o.id
        WHERE om.user_id = $1 AND q.project_id = $2`;
      dataQuery = `
        SELECT q.*, p.name as project_name,
               rp.name as retry_policy_name, rp.strategy as retry_strategy
        FROM queues q
        JOIN projects p ON p.id = q.project_id
        JOIN organizations o ON o.id = p.org_id
        JOIN organization_members om ON om.org_id = o.id
        LEFT JOIN retry_policies rp ON rp.id = q.retry_policy_id
        WHERE om.user_id = $1 AND q.project_id = $2
        ORDER BY q.priority DESC, q.created_at DESC
        LIMIT $3 OFFSET $4`;
      params = [req.user!.id, projectId, pagination.limit, offset];

      const { rows: countRows } = await pool.query(countQuery, [req.user!.id, projectId]);
      const total = parseInt(countRows[0].total, 10);
      const { rows } = await pool.query(dataQuery, params);
      res.json(buildPaginatedResponse(rows, total, pagination));
      return;
    }

    countQuery = `
      SELECT COUNT(*) as total FROM queues q
      JOIN projects p ON p.id = q.project_id
      JOIN organizations o ON o.id = p.org_id
      JOIN organization_members om ON om.org_id = o.id
      WHERE om.user_id = $1`;
    dataQuery = `
      SELECT q.*, p.name as project_name,
             rp.name as retry_policy_name, rp.strategy as retry_strategy
      FROM queues q
      JOIN projects p ON p.id = q.project_id
      JOIN organizations o ON o.id = p.org_id
      JOIN organization_members om ON om.org_id = o.id
      LEFT JOIN retry_policies rp ON rp.id = q.retry_policy_id
      WHERE om.user_id = $1
      ORDER BY q.priority DESC, q.created_at DESC
      LIMIT $2 OFFSET $3`;

    const { rows: countRows } = await pool.query(countQuery, [req.user!.id]);
    const total = parseInt(countRows[0].total, 10);
    const { rows } = await pool.query(dataQuery, [req.user!.id, pagination.limit, offset]);
    res.json(buildPaginatedResponse(rows, total, pagination));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /queues/:id
 * Get queue details.
 */
router.get('/queues/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query(
      `SELECT q.*, p.name as project_name,
              rp.name as retry_policy_name, rp.strategy as retry_strategy,
              rp.base_delay_ms, rp.max_retries, rp.max_delay_ms, rp.jitter
       FROM queues q
       JOIN projects p ON p.id = q.project_id
       JOIN organizations o ON o.id = p.org_id
       JOIN organization_members om ON om.org_id = o.id
       LEFT JOIN retry_policies rp ON rp.id = q.retry_policy_id
       WHERE q.id = $1 AND om.user_id = $2`,
      [req.params.id, req.user!.id]
    );

    if (rows.length === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Queue not found');
    }

    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /queues/:id
 * Update queue configuration (priority, concurrency, retry policy, pause/resume).
 */
router.patch('/queues/:id', validate(updateQueueSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updates = req.body;
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        setClauses.push(`${key} = $${paramIdx}`);
        values.push(value);
        paramIdx++;
      }
    }

    if (setClauses.length === 0) {
      throw new AppError(400, 'BAD_REQUEST', 'No fields to update');
    }

    values.push(req.params.id);
    values.push(req.user!.id);

    const { rows } = await pool.query(
      `UPDATE queues q SET ${setClauses.join(', ')}
       FROM projects p
       JOIN organizations o ON o.id = p.org_id
       JOIN organization_members om ON om.org_id = o.id
       WHERE q.project_id = p.id AND q.id = $${paramIdx} AND om.user_id = $${paramIdx + 1} AND om.role IN ('owner', 'admin', 'operator')
       RETURNING q.*`,
      values
    );

    if (rows.length === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Queue not found');
    }

    await publishEvent(pool, 'queue.updated', 'queue', rows[0].id, rows[0]);
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /queues/:id/stats
 * Queue statistics: job counts by status, throughput, success rate, avg duration.
 */
router.get('/queues/:id/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Verify access
    const { rows: queueCheck } = await pool.query(
      `SELECT q.id FROM queues q
       JOIN projects p ON p.id = q.project_id
       JOIN organizations o ON o.id = p.org_id
       JOIN organization_members om ON om.org_id = o.id
       WHERE q.id = $1 AND om.user_id = $2`,
      [req.params.id, req.user!.id]
    );
    if (queueCheck.length === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Queue not found');
    }

    // Job counts by status
    const { rows: statusCounts } = await pool.query(
      `SELECT status, COUNT(*) as count FROM jobs WHERE queue_id = $1 GROUP BY status`,
      [req.params.id]
    );

    const counts: Record<string, number> = {};
    let totalJobs = 0;
    for (const row of statusCounts) {
      counts[row.status] = parseInt(row.count, 10);
      totalJobs += parseInt(row.count, 10);
    }

    // Average execution duration (completed jobs only)
    const { rows: avgDuration } = await pool.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000) as avg_ms
       FROM job_executions
       WHERE job_id IN (SELECT id FROM jobs WHERE queue_id = $1)
       AND status = 'completed' AND finished_at IS NOT NULL`,
      [req.params.id]
    );

    // Throughput: completed jobs in last 5 minutes
    const { rows: throughput } = await pool.query(
      `SELECT COUNT(*) as count FROM jobs
       WHERE queue_id = $1 AND status = 'completed'
       AND updated_at >= now() - interval '5 minutes'`,
      [req.params.id]
    );

    const completedCount = counts['completed'] || 0;
    const failedCount = counts['failed'] || 0;
    const deadLetterCount = counts['dead_letter'] || 0;
    const totalFinished = completedCount + failedCount + deadLetterCount;

    res.json({
      data: {
        total_jobs: totalJobs,
        blocked: counts['blocked'] || 0,
        queued: counts['queued'] || 0,
        scheduled: counts['scheduled'] || 0,
        claimed: counts['claimed'] || 0,
        running: counts['running'] || 0,
        completed: completedCount,
        failed: failedCount,
        dead_letter: deadLetterCount,
        avg_execution_ms: avgDuration[0]?.avg_ms ? Math.round(parseFloat(avgDuration[0].avg_ms)) : null,
        success_rate: totalFinished > 0 ? Math.round((completedCount / totalFinished) * 10000) / 100 : null,
        throughput_per_minute: throughput[0] ? Math.round(parseInt(throughput[0].count, 10) / 5 * 100) / 100 : 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /retry-policies
 * List all available retry policies.
 */
router.get('/retry-policies', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query('SELECT * FROM retry_policies ORDER BY name');
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

export default router;
