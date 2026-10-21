import { compact } from '../../domain/identifiers.js';
import {
  DuplicateInvoiceError, KeyTakenError, type ExtractionLog, type ExtractionLogEntry, type InvoiceRecord, type InvoiceRepository, type InvoiceStatus,
} from '../../application/ports.js';

/** Keeps everything in memory. For tests, and for trying the API without a database. */
export class InMemoryInvoices implements InvoiceRepository {
  private readonly byId = new Map<string, InvoiceRecord>();
  private readonly byKey = new Map<string, { id: string; fingerprint: string }>();

  /** The same rule as the database's unique index invoices_one_paid_copy. */
  private wouldBeSecondPaidCopy(record: InvoiceRecord): boolean {
    const paid = (r: InvoiceRecord) => r.status === 'ACCEPTED' || r.status === 'APPROVED';
    const kvk = record.extracted?.supplierKvk;
    return paid(record) && kvk != null && [...this.byId.values()].some((other) => other.id !== record.id && paid(other)
      && other.extracted?.invoiceNumber === record.extracted?.invoiceNumber
      && other.extracted?.supplierKvk != null && compact(other.extracted.supplierKvk) === compact(kvk));
  }

  create(record: InvoiceRecord, idempotencyKey: string, fingerprint: string): Promise<InvoiceRecord> {
    if (this.byKey.has(idempotencyKey)) {
      return Promise.reject(new KeyTakenError(idempotencyKey));
    }
    if (this.wouldBeSecondPaidCopy(record)) {
      return Promise.reject(new DuplicateInvoiceError(record.id));
    }
    this.byId.set(record.id, record);
    this.byKey.set(idempotencyKey, { id: record.id, fingerprint });
    return Promise.resolve(record);
  }

  findById(id: string): Promise<InvoiceRecord | undefined> {
    return Promise.resolve(this.byId.get(id));
  }

  findByIdempotencyKey(key: string) {
    const entry = this.byKey.get(key);
    const record = entry && this.byId.get(entry.id);
    return Promise.resolve(entry && record ? { record, fingerprint: entry.fingerprint } : undefined);
  }

  existsForSupplier(supplierKvk: string, invoiceNumber: string): Promise<boolean> {
    return Promise.resolve([...this.byId.values()].some((record) => record.status !== 'REJECTED'
      && record.extracted?.invoiceNumber === invoiceNumber
      && record.extracted.supplierKvk !== null && compact(record.extracted.supplierKvk) === supplierKvk));
  }

  listByStatus(status: InvoiceStatus, limit: number): Promise<InvoiceRecord[]> {
    return Promise.resolve([...this.byId.values()].filter((r) => r.status === status)
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)).slice(0, limit));
  }

  update(record: InvoiceRecord, expectedVersion: number): Promise<InvoiceRecord | undefined> {
    if (this.byId.get(record.id)?.version !== expectedVersion) {
      return Promise.resolve(undefined);
    }
    if (this.wouldBeSecondPaidCopy(record)) {
      return Promise.reject(new DuplicateInvoiceError(record.id));
    }
    this.byId.set(record.id, record);
    return Promise.resolve(record);
  }
}

export class InMemoryExtractionLog implements ExtractionLog {
  readonly entries: ExtractionLogEntry[] = [];

  record(entry: ExtractionLogEntry): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }
}
