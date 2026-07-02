import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../../config/db';
import { authMiddleware } from '../../middleware/auth';
import { parsePagination, paginationOffset, buildPaginatedResponse } from '../../middleware/pagination';

const router = Router();

router.use(authMiddleware);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pagination = parsePagination(req);
    const offset = paginationOffset(pagination);
    const eventType = req.query.event_type as string | undefined;
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (eventType) {
      params.push(eventType);
      conditions.push(`event_type = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) as total FROM system_events ${whereClause}`,
      params
    );
    const total = parseInt(countRows[0].total, 10);

    const { rows } = await pool.query(
      `SELECT * FROM system_events
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pagination.limit, offset]
    );

    res.json(buildPaginatedResponse(rows, total, pagination));
  } catch (err) {
    next(err);
  }
});

export default router;
