import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../../config/db';
import { authMiddleware } from '../../middleware/auth';
import { parsePagination, paginationOffset, buildPaginatedResponse } from '../../middleware/pagination';
import { AppError } from '../../middleware/errorHandler';
import { publishEvent } from '../../engine/events';

const router = Router();

router.use(authMiddleware);

/**
 * GET /batches
 * List batches accessible to the user with pagination and optional queue_id filter.
 */
router.get('/batches', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pagination = parsePagination(req);
    const offset = paginationOffset(pagination);

    const conditions: string[] = ['om.user_id = $1'];
    const params: unknown[] = [req.user!.id];
    let paramIdx = 2;

    if (req.query.queue_id) {
      conditions.push(`b.queue_id = $${paramIdx}`);
      params.push(req.query.queue_id);
      paramIdx++;
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countQuery = `
      SELECT COUNT(*) as total FROM batches b
      JOIN queues q ON q.id = b.queue_id
      JOIN projects p ON p.id = q.project_id
      JOIN organization_members om ON om.org_id = p.org_id
      ${whereClause}`;

    const dataQuery = `
      SELECT b.*, q.name as queue_name FROM batches b
      JOIN queues q ON q.id = b.queue_id
      JOIN projects p ON p.id = q.project_id
      JOIN organization_members om ON om.org_id = p.org_id
      ${whereClause}
      ORDER BY b.created_at DESC
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
 * GET /batches/:id
 * Get batch details.
 */
router.get('/batches/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.*, q.name as queue_name FROM batches b
       JOIN queues q ON q.id = b.queue_id
       JOIN projects p ON p.id = q.project_id
       JOIN organization_members om ON om.org_id = p.org_id
       WHERE b.id = $1 AND om.user_id = $2`,
      [req.params.id, req.user!.id]
    );

    if (rows.length === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Batch not found');
    }

    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /batches/:id/jobs
 * List jobs belonging to a specific batch.
 */
router.get('/batches/:id/jobs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pagination = parsePagination(req);
    const offset = paginationOffset(pagination);

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) as total FROM jobs j
       JOIN batches b ON b.id = j.batch_id
       JOIN queues q ON q.id = b.queue_id
       JOIN projects p ON p.id = q.project_id
       JOIN organization_members om ON om.org_id = p.org_id
       WHERE b.id = $1 AND om.user_id = $2`,
      [req.params.id, req.user!.id]
    );
    const total = parseInt(countRows[0].total, 10);

    const { rows } = await pool.query(
      `SELECT j.* FROM jobs j
       JOIN batches b ON b.id = j.batch_id
       JOIN queues q ON q.id = b.queue_id
       JOIN projects p ON p.id = q.project_id
       JOIN organization_members om ON om.org_id = p.org_id
       WHERE b.id = $1 AND om.user_id = $4
       ORDER BY j.created_at ASC
       LIMIT $2 OFFSET $3`,
      [req.params.id, pagination.limit, offset, req.user!.id]
    );

    res.json(buildPaginatedResponse(rows, total, pagination));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /batches/:id/cancel
 * Cancel a batch and mark pending jobs as cancelled.
 */
router.post('/batches/:id/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows: batchRows } = await pool.query(
      `SELECT b.* FROM batches b
       JOIN queues q ON q.id = b.queue_id
       JOIN projects p ON p.id = q.project_id
       JOIN organization_members om ON om.org_id = p.org_id
       WHERE b.id = $1 AND om.user_id = $2 AND om.role IN ('owner', 'admin', 'operator')`,
      [req.params.id, req.user!.id]
    );

    if (batchRows.length === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Batch not found');
    }

    const { rows: updatedBatch } = await pool.query(
      `UPDATE batches SET status = 'cancelled', updated_at = now() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );

    // Cancel remaining queued/scheduled jobs for this batch
    await pool.query(
      `UPDATE jobs SET status = 'failed', failure_summary = 'Batch cancelled by user', updated_at = now()
       WHERE batch_id = $1 AND status IN ('queued', 'scheduled', 'blocked')`,
      [req.params.id]
    );

    await publishEvent(pool, 'batch.cancelled', 'batch', req.params.id, updatedBatch[0]);
    res.json({ data: updatedBatch[0] });
  } catch (err) {
    next(err);
  }
});

export default router;
