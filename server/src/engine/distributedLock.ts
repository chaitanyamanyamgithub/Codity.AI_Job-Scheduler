import { Pool, PoolClient } from 'pg';

export async function acquireDistributedLock(
  db: Pool | PoolClient,
  lockKey: string,
  ownerId: string,
  ttlMs: number,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `INSERT INTO distributed_locks (lock_key, owner_id, expires_at)
     VALUES ($1, $2, now() + make_interval(secs => $3::double precision / 1000))
     ON CONFLICT (lock_key) DO UPDATE
       SET owner_id = EXCLUDED.owner_id,
           expires_at = EXCLUDED.expires_at,
           acquired_at = now()
     WHERE distributed_locks.expires_at <= now()
        OR distributed_locks.owner_id = EXCLUDED.owner_id`,
    [lockKey, ownerId, ttlMs]
  );

  return (rowCount ?? 0) > 0;
}

export async function releaseDistributedLock(
  db: Pool | PoolClient,
  lockKey: string,
  ownerId: string,
): Promise<void> {
  await db.query(
    'DELETE FROM distributed_locks WHERE lock_key = $1 AND owner_id = $2',
    [lockKey, ownerId]
  );
}
