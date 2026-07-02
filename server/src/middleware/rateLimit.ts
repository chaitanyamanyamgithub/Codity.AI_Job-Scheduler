import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/db';
import { env } from '../config/env';

export async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.path === '/health') {
      next();
      return;
    }

    const identity = req.user?.id || req.ip || 'anonymous';
    const routeKey = `${req.method}:${req.route?.path || req.path}`;
    const limit = ['POST', 'PATCH', 'DELETE'].includes(req.method)
      ? env.RATE_LIMIT_MUTATION_REQUESTS
      : env.RATE_LIMIT_READ_REQUESTS;
    const windowStart = new Date(Math.floor(Date.now() / env.RATE_LIMIT_WINDOW_MS) * env.RATE_LIMIT_WINDOW_MS);

    const { rows } = await pool.query(
      `INSERT INTO api_rate_limits (identity_key, route_key, window_start, request_count)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (identity_key, route_key, window_start)
       DO UPDATE SET request_count = api_rate_limits.request_count + 1
       RETURNING request_count`,
      [identity, routeKey, windowStart]
    );

    const remaining = Math.max(0, limit - rows[0].request_count);
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(remaining));

    if (rows[0].request_count > limit) {
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please wait for the current rate-limit window to reset.',
        },
      });
      return;
    }

    next();
  } catch (err) {
    next(err);
  }
}
