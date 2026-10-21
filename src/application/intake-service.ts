import { createHash, randomUUID } from 'node:crypto';
import { compact } from '../domain/identifiers.js';
import type { CheckResult, ExtractedInvoice } from '../domain/invoice.js';
import { verify } from '../domain/verification.js';
import { IdempotencyKeyReusedError, IllegalTransitionError, NotFoundError, VersionMismatchError } from './errors.js';
import { extractionContract } from './extraction-contract.js';
import {
  ExtractorUnavailableError, KeyTakenError,
  type ExtractionLog, type ExtractionOutcome, type InvoiceExtractor, type InvoiceRecord, type InvoiceRepository, type InvoiceStatus, type ModelUsage,
} from './ports.js';

export interface IntakeDependencies {
  readonly extractor: InvoiceExtractor;
  readonly invoices: InvoiceRepository;
  readonly extractionLog: ExtractionLog;
  readonly now: () => Date;
}

function fingerprint(sourceText: string): string {
  return createHash('sha256').update(sourceText, 'utf8').digest('hex');
}

/**
 * The use cases. The model reads the invoice; this class decides. An invoice is accepted
 * without a person only when the reply matches the contract and every check passes.
 */
export class IntakeService {
  constructor(private readonly deps: IntakeDependencies) {}

  async submit(sourceText: string, idempotencyKey: string): Promise<InvoiceRecord> {
    const print = fingerprint(sourceText);
    const existing = await this.deps.invoices.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      return sameRequestOrConflict(existing, print, idempotencyKey);
    }
    const id = randomUUID();
    const receivedAt = this.deps.now().toISOString();
    const triage = await this.extractAndCheck(id, sourceText, receivedAt.slice(0, 10));
    const record: InvoiceRecord = { id, sourceText, receivedAt, version: 1, ...triage };
    try {
      return await this.deps.invoices.create(record, idempotencyKey, print);
    } catch (error) {
      if (!(error instanceof KeyTakenError)) {
        throw error;
      }
      const winner = await this.deps.invoices.findByIdempotencyKey(idempotencyKey);
      if (!winner) {
        throw error;
      }
      return sameRequestOrConflict(winner, print, idempotencyKey);
    }
  }

  private async extractAndCheck(id: string, sourceText: string, today: string):
    Promise<Pick<InvoiceRecord, 'status' | 'extracted' | 'checks' | 'note'>> {
    let reply: unknown;
    let usage: ModelUsage;
    const started = performance.now();
    try {
      ({ reply, usage } = await this.deps.extractor.extract(sourceText));
    } catch (error) {
      if (!(error instanceof ExtractorUnavailableError)) {
        throw error;
      }
      await this.log(id, { model: null, inputTokens: 0, outputTokens: 0, latencyMs: Math.round(performance.now() - started) },
        'FAILED');
      return { status: 'NEEDS_REVIEW', extracted: null, checks: [], note: 'the model was unavailable' };
    }
    const parsed = extractionContract.safeParse(reply);
    if (!parsed.success) {
      await this.log(id, usage, 'CONTRACT_VIOLATION');
      return { status: 'NEEDS_REVIEW', extracted: null, checks: [], note: 'the model reply did not match the contract' };
    }
    const extracted = parsed.data;
    const checks = [...verify(extracted, sourceText, today), await this.duplicateCheck(extracted)];
    const failed = checks.filter((check) => !check.passed);
    await this.log(id, usage, failed.length === 0 ? 'ACCEPTED' : 'SENT_TO_REVIEW');
    return failed.length === 0
      ? { status: 'ACCEPTED', extracted, checks, note: null }
      : { status: 'NEEDS_REVIEW', extracted, checks, note: `failed checks: ${failed.map((c) => c.code).join(', ')}` };
  }

  private async duplicateCheck(invoice: ExtractedInvoice): Promise<CheckResult> {
    if (invoice.supplierKvk === null) {
      return { code: 'NOT_A_DUPLICATE', passed: false, detail: 'no KvK number to check duplicates against' };
    }
    const duplicate = await this.deps.invoices.existsForSupplier(compact(invoice.supplierKvk), invoice.invoiceNumber);
    return { code: 'NOT_A_DUPLICATE', passed: !duplicate,
      detail: duplicate ? 'this supplier already sent this invoice number' : 'first invoice with this number' };
  }

  private async log(invoiceId: string, usage: Omit<ModelUsage, 'model'> & { model: string | null },
                    outcome: ExtractionOutcome) {
    await this.deps.extractionLog.record({ at: this.deps.now().toISOString(), invoiceId, outcome, ...usage });
  }

  async get(id: string): Promise<InvoiceRecord> {
    const record = await this.deps.invoices.findById(id);
    if (!record) {
      throw new NotFoundError(`no invoice with id ${id}`);
    }
    return record;
  }

  reviewQueue(limit: number): Promise<InvoiceRecord[]> {
    return this.deps.invoices.listByStatus('NEEDS_REVIEW', limit);
  }

  approve(id: string, expectedVersion: number, note: string | null): Promise<InvoiceRecord> {
    return this.review(id, expectedVersion, 'APPROVED', note);
  }

  reject(id: string, expectedVersion: number, reason: string): Promise<InvoiceRecord> {
    return this.review(id, expectedVersion, 'REJECTED', reason);
  }

  /** Only invoices waiting for a person can be approved or rejected, and only at the version the reviewer saw. */
  private async review(id: string, expectedVersion: number, status: InvoiceStatus, note: string | null) {
    const record = await this.get(id);
    if (record.version !== expectedVersion) {
      throw new VersionMismatchError(`invoice ${id} is at version ${record.version}, not ${expectedVersion}`);
    }
    if (record.status !== 'NEEDS_REVIEW') {
      throw new IllegalTransitionError(`an invoice in status ${record.status} cannot be ${status.toLowerCase()}`);
    }
    const updated = await this.deps.invoices.update({ ...record, status, note, version: record.version + 1 }, expectedVersion);
    if (!updated) {
      throw new VersionMismatchError(`invoice ${id} was changed by someone else`);
    }
    return updated;
  }
}

function sameRequestOrConflict(stored: { record: InvoiceRecord; fingerprint: string }, print: string, key: string) {
  if (stored.fingerprint !== print) {
    throw new IdempotencyKeyReusedError(`idempotency key ${key} was already used for a different invoice`);
  }
  return stored.record;
}
