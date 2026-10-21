import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

const MIGRATIONS = fileURLToPath(new URL('./migrations/', import.meta.url));

/**
 * Applies the numbered SQL files in order, each once, in its own transaction. An advisory lock
 * keeps two instances starting at the same time from running the same migration twice.
 */
export async function migrate(pool: Pool): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock(4242)');
    await client.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
    const done = new Set((await client.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name));
    const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
    const applied: string[] = [];
    for (const file of files.filter((f) => !done.has(f))) {
      await client.query('begin');
      try {
        await client.query(await readFile(MIGRATIONS + file, 'utf8'));
        await client.query('insert into schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
        applied.push(file);
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    }
    return applied;
  } finally {
    await client.query('select pg_advisory_unlock(4242)');
    client.release();
  }
}
