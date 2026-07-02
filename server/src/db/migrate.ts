import fs from 'fs';
import path from 'path';
import { pool } from '../config/db';
import { logger } from '../config/logger';

const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    // Create migrations tracking table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        filename TEXT UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // Get already-applied migrations
    const { rows: applied } = await client.query('SELECT filename FROM _migrations ORDER BY filename');
    const appliedSet = new Set(applied.map((r: { filename: string }) => r.filename));

    // Read migration files, sorted by name
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (appliedSet.has(file)) {
        logger.debug(`Migration ${file} already applied, skipping`);
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
      logger.info(`Applying migration: ${file}`);

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        logger.info(`Migration ${file} applied successfully`);
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error({ err, file }, `Migration ${file} failed`);
        throw err;
      }
    }

    logger.info('All migrations applied');
  } finally {
    client.release();
  }
}

// Allow running directly: npx tsx src/db/migrate.ts
if (require.main === module) {
  runMigrations()
    .then(() => {
      logger.info('Migration runner complete');
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err }, 'Migration runner failed');
      process.exit(1);
    });
}
