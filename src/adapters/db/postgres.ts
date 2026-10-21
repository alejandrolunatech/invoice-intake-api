import type { Pool } from 'pg';
import { compact } from '../../domain/identifiers.js';
import type { CheckResult, ExtractedInvoice } from '../../domain/invoice.js';
import {
  KeyTakenError, type ExtractionLog, type ExtractionLogEntry, type InvoiceRecord, type InvoiceRepository, type InvoiceStatus,
} from '../../application/ports.js';

interface Row {
  id: string;
  status: InvoiceStatus;
  source_text: string;
  extracted: ExtractedInvoice | null;
  checks: CheckResult[];
  note: string | null;
  received_at: Date;
  version: number;
  fingerprint: string;
}

const COLUMNS = 'id, status, source_text, extracted, checks, note, received_at, version, fingerprint';

function toRecord(row: Row): InvoiceRecord {
  return {
    id: row.id, status: row.status, sourceText: row.source_text, extracted: row.extracted, checks: row.checks,
    note: row.note, receivedAt: row.received_at.toISOString(), version: row.version,
  };
}

/** Plain SQL with parameters. Every query is visible here; there is no ORM to guess about. */
export class PostgresInvoices implements InvoiceRepository {
  constructor(private readonly pool: Pool) {}

  async create(record: InvoiceRecord, idempotencyKey: string, fingerprint: string): Promise<InvoiceRecord> {
    try {
      await this.pool.query(
        `insert into invoices (id, idempotency_key, fingerprint, status, source_text, extracted, checks, note,
                               supplier_kvk, invoice_number, received_at, version)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [record.id, idempotencyKey, fingerprint, record.status, record.sourceText,
          record.extracted === null ? null : JSON.stringify(record.extracted), JSON.stringify(record.checks), record.note,
          record.extracted?.supplierKvk == null ? null : compact(record.extracted.supplierKvk),
          record.extracted?.invoiceNumber ?? null, record.receivedAt, record.version]);
      return record;
    } catch (error) {
      if (isUniqueViolation(error, 'invoices_idempotency_key_key')) {
        throw new KeyTakenError(idempotencyKey);
      }
      throw error;
    }
  }

  async findById(id: string): Promise<InvoiceRecord | undefined> {
    const { rows } = await this.pool.query<Row>(`select ${COLUMNS} from invoices where id = $1`, [id]);
    return rows[0] && toRecord(rows[0]);
  }

  async findByIdempotencyKey(key: string) {
    const { rows } = await this.pool.query<Row>(`select ${COLUMNS} from invoices where idempotency_key = $1`, [key]);
    return rows[0] && { record: toRecord(rows[0]), fingerprint: rows[0].fingerprint };
  }

  async existsForSupplier(supplierKvk: string, invoiceNumber: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `select 1 from invoices where supplier_kvk = $1 and invoice_number = $2 and status <> 'REJECTED' limit 1`,
      [supplierKvk, invoiceNumber]);
    return rows.length > 0;
  }

  async listByStatus(status: InvoiceStatus, limit: number): Promise<InvoiceRecord[]> {
    const { rows } = await this.pool.query<Row>(
      `select ${COLUMNS} from invoices where status = $1 order by received_at limit $2`, [status, limit]);
    return rows.map(toRecord);
  }

  /** Optimistic locking in one statement: the row changes only if nobody changed it first. */
  async update(record: InvoiceRecord, expectedVersion: number): Promise<InvoiceRecord | undefined> {
    const { rowCount } = await this.pool.query(
      'update invoices set status = $1, note = $2, version = $3 where id = $4 and version = $5',
      [record.status, record.note, record.version, record.id, expectedVersion]);
    return rowCount === 1 ? record : undefined;
  }
}

export class PostgresExtractionLog implements ExtractionLog {
  constructor(private readonly pool: Pool) {}

  async record(entry: ExtractionLogEntry): Promise<void> {
    await this.pool.query(
      `insert into extraction_calls (called_at, invoice_id, model, input_tokens, output_tokens, latency_ms, outcome)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [entry.at, entry.invoiceId, entry.model, entry.inputTokens, entry.outputTokens, entry.latencyMs, entry.outcome]);
  }
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
    && 'constraint' in error && error.constraint === constraint;
}
