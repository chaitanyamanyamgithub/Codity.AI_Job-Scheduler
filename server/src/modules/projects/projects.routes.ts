import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../../config/db';
import { authMiddleware } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { createProjectSchema } from '../../types';
import { parsePagination, paginationOffset, buildPaginatedResponse } from '../../middleware/pagination';
import { AppError } from '../../middleware/errorHandler';
import { hasRoleAtLeast, getProjectRole, OrgRole } from '../../middleware/access';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

/**
 * GET /projects
 * List all projects for the current user. Auto-seeds default project if none exist.
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pagination = parsePagination(req);
    const offset = paginationOffset(pagination);
    const userId = req.user!.id;

    let { rows: countRows } = await pool.query(
      `SELECT COUNT(*) as total FROM projects p
       JOIN organizations o ON o.id = p.org_id
       JOIN organization_members om ON om.org_id = o.id
       WHERE om.user_id = $1`,
      [userId]
    );
    let total = parseInt(countRows[0].total, 10);

    // If user has zero projects, auto-create a default organization, project, and queue
    if (total === 0) {
      const { rows: newOrg } = await pool.query(
        `INSERT INTO organizations (name, owner_id) VALUES ($1, $2) RETURNING id`,
        [`Default Org`, userId]
      );
      const orgId = newOrg[0].id;

      await pool.query(
        `INSERT INTO organization_members (org_id, user_id, role)
         VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`,
        [orgId, userId]
      );

      const { rows: newProj } = await pool.query(
        `INSERT INTO projects (org_id, name) VALUES ($1, 'Default Project') RETURNING id`,
        [orgId]
      );
      const projId = newProj[0].id;

      await pool.query(
        `INSERT INTO queues (project_id, name, priority, concurrency_limit, shard_key)
         VALUES ($1, 'default-queue', 0, 5, 'default') ON CONFLICT DO NOTHING`,
        [projId]
      );

      total = 1;
    }

    const { rows } = await pool.query(
      `SELECT p.*, o.name as org_name FROM projects p
       JOIN organizations o ON o.id = p.org_id
       JOIN organization_members om ON om.org_id = o.id
       WHERE om.user_id = $1
       ORDER BY p.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, pagination.limit, offset]
    );

    res.json(buildPaginatedResponse(rows, total, pagination));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /projects
 * Create a new project. Auto-creates an organization if none exists and a default queue.
 */
router.post('/', validate(createProjectSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, org_name } = req.body;
    const userId = req.user!.id;

    // Get or create organization
    let orgId: string;

    const { rows: existingOrgs } = await pool.query(
      'SELECT id FROM organizations WHERE owner_id = $1 ORDER BY created_at ASC LIMIT 1',
      [userId]
    );

    if (existingOrgs.length > 0 && !org_name) {
      orgId = existingOrgs[0].id;
    } else {
      const orgDisplayName = org_name || `${req.user!.email.split('@')[0]}'s Org`;
      const { rows: newOrg } = await pool.query(
        `INSERT INTO organizations (name, owner_id) VALUES ($1, $2) RETURNING id`,
        [orgDisplayName, userId]
      );
      orgId = newOrg[0].id;
      await pool.query(
        `INSERT INTO organization_members (org_id, user_id, role)
         VALUES ($1, $2, 'owner')
         ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [orgId, userId]
      );
    }

    // Check for duplicate project name within the org
    const { rows: existing } = await pool.query(
      'SELECT id FROM projects WHERE org_id = $1 AND name = $2',
      [orgId, name]
    );
    if (existing.length > 0) {
      throw new AppError(409, 'CONFLICT', `A project named '${name}' already exists in this organization`);
    }

    // Create project
    const { rows } = await pool.query(
      `INSERT INTO projects (org_id, name) VALUES ($1, $2) RETURNING *`,
      [orgId, name]
    );

    // Auto-create a default queue for the new project
    await pool.query(
      `INSERT INTO queues (project_id, name, priority, concurrency_limit, shard_key)
       VALUES ($1, 'main-queue', 0, 5, 'default') ON CONFLICT DO NOTHING`,
      [rows[0].id]
    );

    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /projects/:id
 * Get a single project by ID.
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, o.name as org_name FROM projects p
       JOIN organizations o ON o.id = p.org_id
       JOIN organization_members om ON om.org_id = o.id
       WHERE p.id = $1 AND om.user_id = $2`,
      [req.params.id, req.user!.id]
    );

    if (rows.length === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Project not found');
    }

    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /projects/:id
 * Delete a project and all its queues/jobs (CASCADE).
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM projects p USING organizations o
       JOIN organization_members om ON om.org_id = o.id
       WHERE p.org_id = o.id AND p.id = $1 AND om.user_id = $2 AND om.role IN ('owner', 'admin')`,
      [req.params.id, req.user!.id]
    );

    if (!rowCount || rowCount === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Project not found');
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * GET /projects/:id/members
 * List project organization members and roles.
 */
router.get('/:id/members', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const role = await getProjectRole(req.params.id, req.user!.id);
    if (!role) {
      throw new AppError(404, 'NOT_FOUND', 'Project not found');
    }

    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.name, om.role, om.created_at
       FROM projects p
       JOIN organization_members om ON om.org_id = p.org_id
       JOIN users u ON u.id = om.user_id
       WHERE p.id = $1
       ORDER BY om.role, u.email`,
      [req.params.id]
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /projects/:id/members
 * Add or update a member role. Requires admin or owner.
 */
router.post('/:id/members', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const role = await getProjectRole(req.params.id, req.user!.id);
    if (!role || !hasRoleAtLeast(role, 'admin')) {
      throw new AppError(403, 'FORBIDDEN', 'Admin role is required to manage members');
    }

    const { email, role: memberRole } = req.body as { email?: string; role?: OrgRole };
    if (!email || !memberRole || !['admin', 'operator', 'viewer'].includes(memberRole)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'email and role (admin/operator/viewer) are required');
    }

    const { rows } = await pool.query(
      `WITH project_org AS (
         SELECT org_id FROM projects WHERE id = $1
       ), target_user AS (
         SELECT id FROM users WHERE email = $2
       )
       INSERT INTO organization_members (org_id, user_id, role)
       SELECT project_org.org_id, target_user.id, $3
       FROM project_org, target_user
       ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role
       RETURNING *`,
      [req.params.id, email, memberRole]
    );

    if (rows.length === 0) {
      throw new AppError(404, 'NOT_FOUND', 'User or project not found');
    }

    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

export default router;
