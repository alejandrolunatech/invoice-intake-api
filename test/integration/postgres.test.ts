import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../src/adapters/db/migrate.js';
import { PostgresExtractionLog, PostgresInvoices } from '../../src/adapters/db/postgres.js';
import { createApp } from '../../src/adapters/http/app.js';
import { ScriptedExtractor } from '../../src/adapters/llm/scripted.js';
import { IntakeService } from '../../src/application/intake-service.js';
import { KeyTakenError, type InvoiceRecord } from '../../src/application/ports.js';
import { SOURCE, invoice } from '../support/invoices.js';

/** The real schema on PostgreSQL 17 in Docker: migrations, constraints, JSON columns, locking. */
describe('on PostgreSQL', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    await migrate(pool);
  });

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  const record = (id: string, overrides: Partial<InvoiceRecord> = {}): InvoiceRecord => ({
    id, status: 'NEEDS_REVIEW', sourceText: SOURCE, extracted: invoice(), checks: [], note: 'x',
    receivedAt: '2026-10-21T09:00:00.000Z', version: 1, ...overrides,
  });

  it('runs each migration once', async () => {
    expect(await migrate(pool)).toEqual([]);
    const { rows } = await pool.query<{ name: string }>('select name from schema_migrations');
    expect(rows.map((row) => row.name)).toEqual(['001_create_tables.sql']);
  });

  it('round-trips a record, JSON columns included', async () => {
    const invoices = new PostgresInvoices(pool);
    const stored = record('00000000-0000-4000-8000-000000000001');
    await invoices.create(stored, 'pg-key-0001', 'f'.repeat(64));

    expect(await invoices.findById(stored.id)).toEqual(stored);
    expect((await invoices.findByIdempotencyKey('pg-key-0001'))?.fingerprint).toBe('f'.repeat(64));
  });

  it('stores an idempotency key once', async () => {
    const invoices = new PostgresInvoices(pool);
    await invoices.create(record('00000000-0000-4000-8000-000000000002'), 'pg-key-0002', 'a'.repeat(64));

    await expect(invoices.create(record('00000000-0000-4000-8000-000000000003'), 'pg-key-0002', 'a'.repeat(64)))
      .rejects.toThrow(KeyTakenError);
  });

  it('lets only the first of two changes at the same version win', async () => {
    const invoices = new PostgresInvoices(pool);
    const stored = record('00000000-0000-4000-8000-000000000004');
    await invoices.create(stored, 'pg-key-0004', 'b'.repeat(64));

    expect(await invoices.update({ ...stored, status: 'APPROVED', version: 2 }, 1)).toBeDefined();
    expect(await invoices.update({ ...stored, status: 'REJECTED', version: 2 }, 1)).toBeUndefined();
    expect((await invoices.findById(stored.id))?.status).toBe('APPROVED');
  });

  it('serves the whole flow over HTTP and logs the call without the invoice text', async () => {
    const intake = new IntakeService({
      extractor: new ScriptedExtractor(), invoices: new PostgresInvoices(pool), extractionLog: new PostgresExtractionLog(pool),
      now: () => new Date('2026-10-21T09:00:00Z'),
    });
    const server = createApp(intake, pino({ level: 'silent' }));
    const text = SOURCE.replace('2026-0042', '2026-0077');

    const created = await request(server).post('/api/invoices').set('Idempotency-Key', 'pg-http-0001').send({ text });
    const duplicate = await request(server).post('/api/invoices').set('Idempotency-Key', 'pg-http-0002').send({ text: `${text}\n` });

    expect(created.body.status).toBe('ACCEPTED');
    expect(duplicate.body.failedChecks).toEqual(['NOT_A_DUPLICATE']);
    const { rows } = await pool.query('select * from extraction_calls where invoice_id = $1', [created.body.id]);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain('Hoorn');
  });
});
