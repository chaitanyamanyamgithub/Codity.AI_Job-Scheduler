import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../../config/db';
import { env } from '../../config/env';
import { validate } from '../../middleware/validate';
import { registerSchema, loginSchema, UserPayload } from '../../types';
import { AppError } from '../../middleware/errorHandler';

const router = Router();

/**
 * POST /auth/register
 * Create a new user account.
 */
router.post('/register', validate(registerSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, name } = req.body;

    // Check if user already exists
    const { rows: existing } = await pool.query(
      'SELECT id FROM users WHERE email = $1', [email]
    );
    if (existing.length > 0) {
      throw new AppError(409, 'CONFLICT', 'A user with this email already exists');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3) RETURNING id, email, name, created_at`,
      [email, passwordHash, name || null]
    );

    const user = rows[0];

    // Generate JWT
    const token = jwt.sign({ id: user.id, email: user.email }, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN as any,
    });

    res.status(201).json({
      data: {
        user: { id: user.id, email: user.email, name: user.name, created_at: user.created_at },
        token,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/login
 * Authenticate and receive a JWT.
 */
router.post('/login', validate(loginSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;

    // Find user
    const { rows } = await pool.query(
      'SELECT id, email, name, password_hash, created_at FROM users WHERE email = $1',
      [email]
    );

    if (rows.length === 0) {
      throw new AppError(401, 'UNAUTHORIZED', 'Invalid email or password');
    }

    const user = rows[0];

    // Verify password
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      throw new AppError(401, 'UNAUTHORIZED', 'Invalid email or password');
    }

    // Generate JWT
    const token = jwt.sign({ id: user.id, email: user.email }, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN as any,
    });

    res.json({
      data: {
        user: { id: user.id, email: user.email, name: user.name, created_at: user.created_at },
        token,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
