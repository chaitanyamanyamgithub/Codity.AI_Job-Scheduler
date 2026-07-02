import { pool } from '../config/db';

export type OrgRole = 'owner' | 'admin' | 'operator' | 'viewer';

const roleRank: Record<OrgRole, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
  owner: 4,
};

export function hasRoleAtLeast(actual: OrgRole, required: OrgRole): boolean {
  return roleRank[actual] >= roleRank[required];
}

export async function getProjectRole(projectId: string, userId: string): Promise<OrgRole | null> {
  const { rows } = await pool.query(
    `SELECT om.role
     FROM projects p
     JOIN organization_members om ON om.org_id = p.org_id
     WHERE p.id = $1 AND om.user_id = $2`,
    [projectId, userId]
  );
  return rows[0]?.role ?? null;
}

export async function getQueueRole(queueId: string, userId: string): Promise<OrgRole | null> {
  const { rows } = await pool.query(
    `SELECT om.role
     FROM queues q
     JOIN projects p ON p.id = q.project_id
     JOIN organization_members om ON om.org_id = p.org_id
     WHERE q.id = $1 AND om.user_id = $2`,
    [queueId, userId]
  );
  return rows[0]?.role ?? null;
}

export async function getJobRole(jobId: string, userId: string): Promise<OrgRole | null> {
  const { rows } = await pool.query(
    `SELECT om.role
     FROM jobs j
     JOIN queues q ON q.id = j.queue_id
     JOIN projects p ON p.id = q.project_id
     JOIN organization_members om ON om.org_id = p.org_id
     WHERE j.id = $1 AND om.user_id = $2`,
    [jobId, userId]
  );
  return rows[0]?.role ?? null;
}
