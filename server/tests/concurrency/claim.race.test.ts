import { pool } from '../../src/config/db';
import { runMigrations } from '../../src/db/migrate';
import { claimNextJob } from '../../src/engine/claimer';
import { Job } from '../../src/types';

describe('Concurrency & Claim Race (Race Test)', () => {
  let projectId: string;
  let queueId: string;
  const CONCURRENCY_LIMIT = 3;
  const TOTAL_JOBS_SEEDED = 10;

  beforeAll(async () => {
    await runMigrations();

    // Clean DB
    await pool.query('TRUNCATE users CASCADE');
    await pool.query('TRUNCATE workers CASCADE');

    // Create a dummy project and a queue with concurrency_limit = 3
    const { rows: orgRows } = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ('race-test@example.com', 'hash', 'Race User') RETURNING id`
    );
    const userId = orgRows[0].id;

    const { rows: orgObjRows } = await pool.query(
      `INSERT INTO organizations (name, owner_id) VALUES ('Race Org', $1) RETURNING id`,
      [userId]
    );
    const orgId = orgObjRows[0].id;

    const { rows: projRows } = await pool.query(
      `INSERT INTO projects (org_id, name) VALUES ($1, 'Race Project') RETURNING id`,
      [orgId]
    );
    projectId = projRows[0].id;

    const { rows: queueRows } = await pool.query(
      `INSERT INTO queues (project_id, name, concurrency_limit, priority)
       VALUES ($1, 'race-queue', $2, 0) RETURNING id`,
      [projectId, CONCURRENCY_LIMIT]
    );
    queueId = queueRows[0].id;
  });

  beforeEach(async () => {
    // Clear jobs & workers before each run
    await pool.query('DELETE FROM jobs');
    await pool.query('DELETE FROM workers');
  });

  afterAll(async () => {
    await pool.end();
  });

  test('Claiming from N concurrent workers respects queue concurrency limits and avoids double-claiming', async () => {
    // 1. Register N workers in workers table
    const workerCount = 10;
    const workerIds: string[] = [];
    for (let i = 0; i < workerCount; i++) {
      const { rows } = await pool.query(
        `INSERT INTO workers (name, status) VALUES ($1, 'idle') RETURNING id`,
        [`race-worker-${i}`]
      );
      workerIds.push(rows[0].id);
    }

    // 2. Seed M jobs into the queue (all eligible immediately)
    const seededJobIds: string[] = [];
    for (let i = 0; i < TOTAL_JOBS_SEEDED; i++) {
      const { rows } = await pool.query(
        `INSERT INTO jobs (queue_id, type, payload, status, priority, run_at)
         VALUES ($1, 'immediate', $2, 'queued', 0, now()) RETURNING id`,
        [queueId, JSON.stringify({ index: i })]
      );
      seededJobIds.push(rows[0].id);
    }

    // 3. Trigger concurrent claims from all N workers at the same time
    // We launch all promises simultaneously using Promise.all
    const claimPromises = workerIds.map((workerId) =>
      claimNextJob(pool, workerId, [queueId])
    );

    const claimedResults = await Promise.all(claimPromises);

    // 4. Analyze results
    const successfullyClaimedJobs = claimedResults.filter((j): j is Job => j !== null);

    // Assert 1: Concurrency limit is strictly enforced
    // The query should not have claimed more than CONCURRENCY_LIMIT (3) jobs,
    // since each job goes into 'claimed' (in-flight) and subsequent claims check capacity.
    expect(successfullyClaimedJobs.length).toBeLessThanOrEqual(CONCURRENCY_LIMIT);

    // Assert 2: No job was claimed by more than one worker (no double claim)
    const claimedJobIds = successfullyClaimedJobs.map((j) => j.id);
    const uniqueClaimedJobIds = new Set(claimedJobIds);
    expect(claimedJobIds.length).toBe(uniqueClaimedJobIds.size);

    // Assert 3: Workers assigned to claimed jobs match the claiming workers
    successfullyClaimedJobs.forEach((job) => {
      expect(job.worker_id).not.toBeNull();
      expect(workerIds).toContain(job.worker_id);
    });

    // 5. Verify the DB state
    const { rows: dbClaimedJobs } = await pool.query(
      `SELECT id, worker_id, status FROM jobs WHERE status = 'claimed'`
    );
    expect(dbClaimedJobs.length).toBe(successfullyClaimedJobs.length);
  });
});
