import request from 'supertest';
import app from '../../src/app';
import { pool } from '../../src/config/db';
import { runMigrations } from '../../src/db/migrate';

describe('Jobs & Queues API (Integration)', () => {
  let token: string;
  let projectId: string;
  let queueId: string;

  beforeAll(async () => {
    await runMigrations();

    // Clean DB
    await pool.query('TRUNCATE users CASCADE');

    // Register a user to get a valid token
    const regRes = await request(app)
      .post('/auth/register')
      .send({
        email: 'jobs-test@example.com',
        password: 'password123',
        name: 'Jobs tester',
      });
    token = regRes.body.data.token;

    // Create a project
    const projRes = await request(app)
      .post('/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test Project' });
    projectId = projRes.body.data.id;

    // Create a queue
    const queueRes = await request(app)
      .post(`/projects/${projectId}/queues`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'test-queue',
        priority: 10,
        concurrency_limit: 3,
      });
    queueId = queueRes.body.data.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  test('POST /queues/:queueId/jobs creates immediate job successfully', async () => {
    const res = await request(app)
      .post(`/queues/${queueId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'immediate',
        payload: { task: 'test_immediate' },
        priority: 5,
        max_attempts: 3,
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.status).toBe('queued');
    expect(res.body.data.type).toBe('immediate');
  });

  test('POST /queues/:queueId/jobs creates delayed job successfully', async () => {
    const res = await request(app)
      .post(`/queues/${queueId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'delayed',
        payload: { task: 'test_delayed' },
        delay_ms: 5000,
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.status).toBe('queued');
    expect(res.body.data.type).toBe('delayed');
    
    // run_at should be roughly 5 seconds in the future
    const runAt = new Date(res.body.data.run_at).getTime();
    const now = Date.now();
    expect(runAt).toBeGreaterThanOrEqual(now + 4000);
    expect(runAt).toBeLessThanOrEqual(now + 6000);
  });

  test('POST /queues/:queueId/jobs accepts a zero millisecond delay', async () => {
    const res = await request(app)
      .post(`/queues/${queueId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'delayed',
        payload: { task: 'test_zero_delay' },
        delay_ms: 0,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('queued');
  });

  test('POST /queues/:queueId/jobs returns field-level validation details', async () => {
    const res = await request(app)
      .post(`/queues/${queueId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'delayed',
        payload: { task: 'missing_delay' },
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain('delay_ms');
    expect(res.body.error.details).toContainEqual({
      field: 'delay_ms',
      message: 'delay_ms is required for delayed jobs',
    });
  });

  test('POST /queues/:queueId/jobs blocks only on incomplete dependencies', async () => {
    const dependencyRes = await request(app)
      .post(`/queues/${queueId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'immediate',
        payload: { task: 'dependency' },
      });

    expect(dependencyRes.status).toBe(201);

    const blockedRes = await request(app)
      .post(`/queues/${queueId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'immediate',
        payload: { task: 'blocked_child' },
        depends_on: [dependencyRes.body.data.id],
      });

    expect(blockedRes.status).toBe(201);
    expect(blockedRes.body.data.status).toBe('blocked');

    await pool.query(`UPDATE jobs SET status = 'completed' WHERE id = $1`, [dependencyRes.body.data.id]);

    const readyRes = await request(app)
      .post(`/queues/${queueId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'immediate',
        payload: { task: 'ready_child' },
        depends_on: [dependencyRes.body.data.id],
      });

    expect(readyRes.status).toBe(201);
    expect(readyRes.body.data.status).toBe('queued');
  });

  test('POST /queues/:queueId/jobs enforces idempotency key constraint per queue', async () => {
    const idempotencyKey = 'unique-key-123';

    // First request should succeed
    const res1 = await request(app)
      .post(`/queues/${queueId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'immediate',
        payload: { val: 1 },
        idempotency_key: idempotencyKey,
      });
    expect(res1.status).toBe(201);

    // Second request with same key should conflict
    const res2 = await request(app)
      .post(`/queues/${queueId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'immediate',
        payload: { val: 2 },
        idempotency_key: idempotencyKey,
      });
    expect(res2.status).toBe(409);
    expect(res2.body.error.code).toBe('CONFLICT');
  });

  test('GET /jobs returns a paginated list of jobs', async () => {
    const res = await request(app)
      .get('/jobs')
      .set('Authorization', `Bearer ${token}`)
      .query({ page: 1, limit: 2 });

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBe(2);
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(2);
  });

  test('POST /queues/:queueId/jobs creates a batch job successfully', async () => {
    const res = await request(app)
      .post(`/queues/${queueId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'batch',
        batch_jobs: [
          { payload: { item: 1 } },
          { payload: { item: 2 } },
        ],
      });

    expect(res.status).toBe(201);
    const batchId = res.body.data.batch?.id || res.body.data.batch_id;
    expect(batchId).toBeDefined();
    expect(res.body.data.jobs).toHaveLength(2);
    expect(res.body.data.jobs[0].batch_id).toBe(batchId);
  });
});
