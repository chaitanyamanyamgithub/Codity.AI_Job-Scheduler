import request from 'supertest';
import app from '../../src/app';
import { pool } from '../../src/config/db';
import { runMigrations } from '../../src/db/migrate';

describe('Batches API (Integration)', () => {
  let token: string;
  let projectId: string;
  let queueId: string;

  beforeAll(async () => {
    await runMigrations();

    // Clean DB
    await pool.query('TRUNCATE users CASCADE');

    // Register a user
    const regRes = await request(app)
      .post('/auth/register')
      .send({
        email: 'batch-tester@example.com',
        password: 'password123',
        name: 'Batch Tester',
      });
    token = regRes.body.data.token;

    // Create a project
    const projRes = await request(app)
      .post('/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Batch Project' });
    projectId = projRes.body.data.id;

    // Create a queue
    const queueRes = await request(app)
      .post(`/projects/${projectId}/queues`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'batch-test-queue',
        priority: 5,
        concurrency_limit: 5,
      });
    queueId = queueRes.body.data.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  test('POST /queues/:queueId/jobs creates a batch and initializes batches table record', async () => {
    const res = await request(app)
      .post(`/queues/${queueId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'batch',
        task_type: 'simulated',
        callback_url: 'https://httpbin.org/post',
        batch_jobs: [
          { payload: { step: 1 } },
          { payload: { step: 2 } },
          { payload: { step: 3 } },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.batch).toBeDefined();
    expect(res.body.data.batch.id).toBeDefined();
    expect(res.body.data.batch.total_jobs).toBe(3);
    expect(res.body.data.batch.status).toBe('processing');
    expect(res.body.data.jobs).toHaveLength(3);
  });

  test('GET /batches lists user batches with pagination', async () => {
    const res = await request(app)
      .get('/batches')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].total_jobs).toBe(3);
  });

  test('GET /batches/:id returns batch details', async () => {
    const listRes = await request(app)
      .get('/batches')
      .set('Authorization', `Bearer ${token}`);
    const batchId = listRes.body.data[0].id;

    const res = await request(app)
      .get(`/batches/${batchId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(batchId);
    expect(res.body.data.total_jobs).toBe(3);
  });

  test('POST /batches/:id/cancel cancels a batch', async () => {
    const createRes = await request(app)
      .post(`/queues/${queueId}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'batch',
        batch_jobs: [
          { payload: { task: 'cancel_me_1' } },
          { payload: { task: 'cancel_me_2' } },
        ],
      });

    const batchId = createRes.body.data.batch.id;

    const cancelRes = await request(app)
      .post(`/batches/${batchId}/cancel`)
      .set('Authorization', `Bearer ${token}`);

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.status).toBe('cancelled');
  });
});
