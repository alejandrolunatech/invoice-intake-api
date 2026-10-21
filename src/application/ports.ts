import type { CheckResult, ExtractedInvoice } from '../domain/invoice.js';

/** What a model call cost and how long it took. Never the prompt or the reply text. */
export interface ModelUsage {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
}

/** The port to the model. Its reply is unknown data until the contract has parsed it. */
export interface InvoiceExtractor {
  extract(sourceText: string): Promise<{ readonly reply: unknown; readonly usage: ModelUsage }>;
}

/** The model could not answer: timeout, outage, rate limit, or no JSON at all. */
export class ExtractorUnavailableError extends Error {
  override readonly name = 'ExtractorUnavailableError';
}

export type InvoiceStatus = 'ACCEPTED' | 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED';

export interface InvoiceRecord {
  readonly id: string;
  readonly status: InvoiceStatus;
  readonly sourceText: string;
  readonly extracted: ExtractedInvoice | null;
  readonly checks: readonly CheckResult[];
  /** Why a person must look at it, or what the reviewer decided. */
  readonly note: string | null;
  readonly receivedAt: string;
  readonly version: number;
}

export interface InvoiceRepository {
  /** Throws {@link KeyTakenError} when the idempotency key is already stored. */
  create(record: InvoiceRecord, idempotencyKey: string, fingerprint: string): Promise<InvoiceRecord>;
  findById(id: string): Promise<InvoiceRecord | undefined>;
  findByIdempotencyKey(key: string): Promise<{ record: InvoiceRecord; fingerprint: string } | undefined>;
  /** Another invoice, not rejected, from the same supplier with the same number. */
  existsForSupplier(supplierKvk: string, invoiceNumber: string): Promise<boolean>;
  listByStatus(status: InvoiceStatus, limit: number): Promise<InvoiceRecord[]>;
  /** Stores a change if the stored version is still {@code expectedVersion}; returns undefined if not. */
  update(record: InvoiceRecord, expectedVersion: number): Promise<InvoiceRecord | undefined>;
}

export class KeyTakenError extends Error {
  override readonly name = 'KeyTakenError';
}

export type ExtractionOutcome = 'ACCEPTED' | 'SENT_TO_REVIEW' | 'CONTRACT_VIOLATION' | 'FAILED';

/** One model call. {@code model} is null when the call failed before any model answered. */
export interface ExtractionLogEntry {
  readonly at: string;
  readonly invoiceId: string;
  readonly outcome: ExtractionOutcome;
  readonly model: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
}

export interface ExtractionLog {
  record(entry: ExtractionLogEntry): Promise<void>;
}
