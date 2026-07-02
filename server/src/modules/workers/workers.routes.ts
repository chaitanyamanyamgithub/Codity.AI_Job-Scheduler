import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../../config/db';
import { authMiddleware } from '../../middleware/auth';
import { parsePagination, paginationOffset, buildPaginatedResponse } from '../../middleware/pagination';
import { env } from '../../config/env';

const router = Router();

router.use(authMiddleware);

/**
 * GET /workers
 * List all workers with their current status.
 * Workers with heartbeat older than WORKER_STALE_THRESHOLD_MS are marked as stale.
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pagination = parsePagination(req);
    const offset = paginationOffset(pagination);

    const { rows: countRows } = await pool.query('SELECT COUNT(*) as total FROM workers');
    const total = parseInt(countRows[0].total, 10);

    const { rows } = await pool.query(
      `SELECT w.*,
              CASE
                WHEN w.status = 'offline' THEN 'offline'
                WHEN w.last_heartbeat_at < now() - make_interval(secs => $1::double precision / 1000) THEN 'stale'
                ELSE w.status
              END as effective_status,
              (SELECT COUNT(*) FROM jobs j WHERE j.worker_id = w.id AND j.status IN ('claimed', 'running')) as active_jobs
       FROM workers w
       ORDER BY w.started_at DESC
       LIMIT $2 OFFSET $3`,
      [env.WORKER_STALE_THRESHOLD_MS, pagination.limit, offset]
    );

    res.json(buildPaginatedResponse(rows, total, pagination));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /workers/:id/heartbeats
 * Get heartbeat history for a specific worker.
 */
router.get('/:id/heartbeats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pagination = parsePagination(req);
    const offset = paginationOffset(pagination);

    const { rows: countRows } = await pool.query(
      'SELECT COUNT(*) as total FROM worker_heartbeats WHERE worker_id = $1',
      [req.params.id]
    );
    const total = parseInt(countRows[0].total, 10);

    const { rows } = await pool.query(
      `SELECT * FROM worker_heartbeats WHERE worker_id = $1
       ORDER BY heartbeat_at DESC
       LIMIT $2 OFFSET $3`,
      [req.params.id, pagination.limit, offset]
    );

    res.json(buildPaginatedResponse(rows, total, pagination));
  } catch (err) {
    next(err);
  }
});

export default router;
