import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db';
import { env } from '../config/env';
import { UserPayload } from '../types';

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authorization header' },
    });
    return;
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as UserPayload;

    const { rows } = await pool.query('SELECT id, email FROM users WHERE id = $1', [decoded.id]);
    if (rows.length === 0) {
      res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'User session expired or user no longer exists' },
      });
      return;
    }

    req.user = { id: rows[0].id, email: rows[0].email };
    next();
  } catch (err) {
    res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' },
    });
  }
}
