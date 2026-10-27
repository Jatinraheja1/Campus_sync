import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const { Pool } = pg;
if (!process.env.DATABASE_URL) console.warn('[db] DATABASE_URL is not configured');
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: true } : undefined,
  max: Number(process.env.PGPOOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});
pool.on('error', (err) => console.error('[db] idle client error:', err.message));
export async function audit(client, actorId, action, entityType, entityId, details = {}) {
  await client.query(
    'INSERT INTO audit_logs(actor_id, action, entity_type, entity_id, details) VALUES($1,$2,$3,$4,$5)',
    [actorId || null, action, entityType, entityId || null, JSON.stringify(details)]
  );
}
