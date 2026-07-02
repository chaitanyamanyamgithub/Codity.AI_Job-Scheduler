import request from 'supertest';
import app from '../../src/app';
import { pool } from '../../src/config/db';
import { runMigrations } from '../../src/db/migrate';

describe('Auth API (Integration)', () => {
  beforeAll(async () => {
    // Ensure migrations are run on the test DB
    await runMigrations();
  });

  beforeEach(async () => {
    // Clean up tables to avoid cross-test contamination.
    // Use TRUNCATE CASCADE to clean all foreign keys.
    await pool.query('TRUNCATE users CASCADE');
  });

  afterAll(async () => {
    await pool.end();
  });

  test('POST /auth/register successfully registers a new user and returns a token', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({
        email: 'test@example.com',
        password: 'securepassword123',
        name: 'Test User',
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.user).toBeDefined();
    expect(res.body.data.user.email).toBe('test@example.com');
    expect(res.body.data.user.name).toBe('Test User');
    expect(res.body.data.user.password_hash).toBeUndefined(); // Ensure hash is not exposed
  });

  test('POST /auth/register returns 409 conflict when email is already registered', async () => {
    // Insert first user
    await request(app)
      .post('/auth/register')
      .send({
        email: 'test@example.com',
        password: 'securepassword123',
        name: 'Test User',
      });

    // Try to register again with same email
    const res = await request(app)
      .post('/auth/register')
      .send({
        email: 'test@example.com',
        password: 'anotherpassword',
        name: 'Another User',
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('CONFLICT');
  });

  test('POST /auth/register returns 400 validation error for invalid email/password length', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({
        email: 'not-an-email',
        password: '123', // less than 6 chars
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toBeDefined();
  });

  test('POST /auth/login successfully logs in and returns a token', async () => {
    // Register the user first
    await request(app)
      .post('/auth/register')
      .send({
        email: 'login@example.com',
        password: 'mypassword',
        name: 'Login User',
      });

    // Log in
    const res = await request(app)
      .post('/auth/login')
      .send({
        email: 'login@example.com',
        password: 'mypassword',
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.user.email).toBe('login@example.com');
  });

  test('POST /auth/login returns 401 unauthorized for wrong password', async () => {
    await request(app)
      .post('/auth/register')
      .send({
        email: 'wrong-pass@example.com',
        password: 'correctpassword',
      });

    const res = await request(app)
      .post('/auth/login')
      .send({
        email: 'wrong-pass@example.com',
        password: 'wrongpassword',
      });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});
