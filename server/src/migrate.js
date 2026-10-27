import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';
const here = path.dirname(fileURLToPath(import.meta.url));
try {
  const dir = path.join(here, '..', 'migrations');
  const names = (await fs.readdir(dir)).filter(x => x.endsWith('.sql')).sort();
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  for (const name of names) {
    const found = await pool.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name]);
    if (found.rowCount) { console.log(`skip ${name}`); continue; }
    const sql = await fs.readFile(path.join(dir,name),'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name) VALUES($1)',[name]);
      await client.query('COMMIT');
      console.log(`applied ${name}`);
    } catch(e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  }
} catch (e) { console.error('[migrate] failed:', e.message); process.exitCode=1; }
finally { await pool.end(); }
