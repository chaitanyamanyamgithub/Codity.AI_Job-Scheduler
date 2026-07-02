import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../../config/db';
import { authMiddleware } from '../../middleware/auth';
import { parsePagination, paginationOffset, buildPaginatedResponse } from '../../middleware/pagination';
import { AppError } from '../../middleware/errorHandler';
import { publishEvent } from '../../engine/events';

const router = Router();

router.use(authMiddleware);

/**
 * GET /dlq
 * List dead letter queue entries, optionally filtered by queue_id.
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pagination = parsePagination(req);
    const offset = paginationOffset(pagination);
    const queueId = req.query.queue_id as string | undefined;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (queueId) {
      conditions.push(`dlq.queue_id = $${paramIdx}`);
      params.push(queueId);
      paramIdx++;
    }
    conditions.push(`om.user_id = $${paramIdx}`);
    params.push(req.user!.id);
    paramIdx++;

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) as total FROM dead_letter_queue dlq
       LEFT JOIN queues q ON q.id = dlq.queue_id
       LEFT JOIN projects p ON p.id = q.project_id
       LEFT JOIN organization_members om ON om.org_id = p.org_id
       ${whereClause}`,
      params
    );
    const total = parseInt(countRows[0].total, 10);

    const { rows } = await pool.query(
      `SELECT dlq.*, q.name as queue_name, j.type as original_job_type
       FROM dead_letter_queue dlq
       LEFT JOIN queues q ON q.id = dlq.queue_id
       LEFT JOIN projects p ON p.id = q.project_id
       LEFT JOIN organization_members om ON om.org_id = p.org_id
       LEFT JOIN jobs j ON j.id = dlq.original_job_id
       ${whereClause}
       ORDER BY dlq.moved_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, pagination.limit, offset]
    );

    res.json(buildPaginatedResponse(rows, total, pagination));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /dlq/:id/replay
 * Re-queue a dead letter entry — resets the original job for another attempt.
 */
router.post('/:id/replay', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Find the DLQ entry
    const { rows: dlqRows } = await pool.query(
      `SELECT dlq.* FROM dead_letter_queue dlq
       LEFT JOIN queues q ON q.id = dlq.queue_id
       LEFT JOIN projects p ON p.id = q.project_id
       LEFT JOIN organization_members om ON om.org_id = p.org_id
       WHERE dlq.id = $1 AND om.user_id = $2 AND om.role IN ('owner', 'admin', 'operator')`,
      [req.params.id, req.user!.id]
    );

    if (dlqRows.length === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Dead letter entry not found');
    }

    const dlqEntry = dlqRows[0];

    if (dlqEntry.original_job_id) {
      // Reset the original job
      const { rows } = await pool.query(
        `UPDATE jobs SET status = 'queued', worker_id = NULL, run_at = now(),
         attempts = 0, updated_at = now() WHERE id = $1 RETURNING *`,
        [dlqEntry.original_job_id]
      );

      // Log the replay
      await pool.query(
        `INSERT INTO job_logs (job_id, level, message) VALUES ($1, 'info', 'Replayed from dead letter queue')`,
        [dlqEntry.original_job_id]
      );

      // Remove DLQ entry
      await pool.query('DELETE FROM dead_letter_queue WHERE id = $1', [req.params.id]);

      await publishEvent(pool, 'dlq.replayed', 'job', rows[0].id, rows[0]);
      res.json({ data: rows[0] });
      return;
    }

    // If original job was deleted, create a new job from the DLQ payload
    if (dlqEntry.queue_id && dlqEntry.payload) {
      const { rows } = await pool.query(
        `INSERT INTO jobs (queue_id, type, payload, status, priority, run_at, max_attempts, shard_key)
         SELECT $1, 'immediate', $2, 'queued', 0, now(), 3, q.shard_key
         FROM queues q
         WHERE q.id = $1
         RETURNING *`,
        [dlqEntry.queue_id, JSON.stringify(dlqEntry.payload)]
      );

      await pool.query('DELETE FROM dead_letter_queue WHERE id = $1', [req.params.id]);

      await publishEvent(pool, 'dlq.replayed', 'job', rows[0].id, rows[0]);
      res.json({ data: rows[0] });
      return;
    }

    throw new AppError(400, 'BAD_REQUEST', 'Cannot replay this dead letter entry — missing queue or payload');
  } catch (err) {
    next(err);
  }
});

export default router;
