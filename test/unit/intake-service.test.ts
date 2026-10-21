import { describe, expect, it } from 'vitest';
import { InMemoryExtractionLog, InMemoryInvoices } from '../../src/adapters/db/memory.js';
import { IdempotencyKeyReusedError, IllegalTransitionError, VersionMismatchError } from '../../src/application/errors.js';
import { IntakeService } from '../../src/application/intake-service.js';
import { ExtractorUnavailableError, KeyTakenError, type InvoiceExtractor, type InvoiceRecord } from '../../src/application/ports.js';
import { SOURCE, invoice } from '../support/invoices.js';

const usage = { model: 'fake', inputTokens: 300, outputTokens: 120, latencyMs: 5 };

function setup(extract: InvoiceExtractor['extract'] = () => Promise.resolve({ reply: invoice(), usage })) {
  const invoices = new InMemoryInvoices();
  const log = new InMemoryExtractionLog();
  let calls = 0;
  const extractor: InvoiceExtractor = { extract: (text) => { calls++; return extract(text); } };
  const service = new IntakeService({ extractor, invoices, extractionLog: log, now: () => new Date('2026-10-21T09:00:00Z') });
  return { service, invoices, log, calls: () => calls };
}

describe('IntakeService', () => {
  it('accepts an invoice when the reply matches the contract and every check passes', async () => {
    const { service, log } = setup();

    const record = await service.submit(SOURCE, 'key-00000001');

    expect(record.status).toBe('ACCEPTED');
    expect(record.checks.every((check) => check.passed)).toBe(true);
    expect(log.entries).toEqual([expect.objectContaining({ outcome: 'ACCEPTED', model: 'fake', inputTokens: 300 })]);
  });

  it('sends an invoice with a failed check to a person, and says which', async () => {
    const { service, log } = setup(() => Promise.resolve({ reply: invoice({ totalGross: '999.00' }), usage }));

    const record = await service.submit(SOURCE, 'key-00000001');

    expect(record.status).toBe('NEEDS_REVIEW');
    expect(record.note).toBe('failed checks: GROSS_ADDS_UP');
    expect(log.entries[0]?.outcome).toBe('SENT_TO_REVIEW');
  });

  it('sends a reply that breaks the contract to a person, without keeping it', async () => {
    const { service, log } = setup(() => Promise.resolve({ reply: { ...invoice(), totalGross: 260.15 }, usage }));

    const record = await service.submit(SOURCE, 'key-00000001');

    expect(record).toMatchObject({ status: 'NEEDS_REVIEW', extracted: null, note: 'the model reply did not match the contract' });
    expect(log.entries[0]?.outcome).toBe('CONTRACT_VIOLATION');
  });

  it('refuses extra fields the contract does not know', async () => {
    const { service } = setup(() => Promise.resolve({ reply: { ...invoice(), approved: true }, usage }));

    expect((await service.submit(SOURCE, 'key-00000001')).extracted).toBeNull();
  });

  it('sends the invoice to a person when the model is down, and logs how long it waited', async () => {
    const { service, log } = setup(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      throw new ExtractorUnavailableError('timeout');
    });

    const record = await service.submit(SOURCE, 'key-00000001');

    expect(record).toMatchObject({ status: 'NEEDS_REVIEW', note: 'the model was unavailable' });
    expect(log.entries[0]).toMatchObject({ outcome: 'FAILED', model: null });
    expect(log.entries[0]?.latencyMs).toBeGreaterThanOrEqual(20);
  });

  it('lets an unexpected error through instead of hiding it', async () => {
    const { service } = setup(() => Promise.reject(new TypeError('bug')));

    await expect(service.submit(SOURCE, 'key-00000001')).rejects.toThrow(TypeError);
  });

  it('returns the first result for a retry, without a second model call', async () => {
    const { service, calls } = setup();

    const first = await service.submit(SOURCE, 'key-00000001');
    const second = await service.submit(SOURCE, 'key-00000001');

    expect(second.id).toBe(first.id);
    expect(calls()).toBe(1);
  });

  it('refuses a reused key with a different invoice', async () => {
    const { service } = setup();
    await service.submit(SOURCE, 'key-00000001');

    await expect(service.submit(`${SOURCE}\nextra line`, 'key-00000001')).rejects.toThrow(IdempotencyKeyReusedError);
  });

  it('returns the winner when it loses a race to the same key', async () => {
    const { service, invoices } = setup();
    const winner = await service.submit(SOURCE, 'key-winner01');
    const create = invoices.create.bind(invoices);
    invoices.create = async (record: InvoiceRecord, key: string, print: string) => {
      await create(winner, key, print);
      invoices.create = create;
      throw new KeyTakenError(key);
    };

    expect((await service.submit(SOURCE, 'key-racing01')).id).toBe(winner.id);
  });

  it('flags the same invoice number from the same supplier as a duplicate', async () => {
    const { service } = setup();
    await service.submit(SOURCE, 'key-00000001');

    const again = await service.submit(`${SOURCE}\nresent`, 'key-00000002');

    expect(again.status).toBe('NEEDS_REVIEW');
    expect(again.note).toBe('failed checks: NOT_A_DUPLICATE');
  });

  it('accepts only one of two copies of the same invoice that arrive at once', async () => {
    const { service } = setup();

    const results = await Promise.all([
      service.submit(SOURCE, 'key-00000001'),
      service.submit(`${SOURCE}\nresent`, 'key-00000002'),
    ]);

    expect(results.map((record) => record.status).sort()).toEqual(['ACCEPTED', 'NEEDS_REVIEW']);
    expect(results.find((record) => record.status === 'NEEDS_REVIEW')?.note).toBe('failed checks: NOT_A_DUPLICATE');
  });

  it('refuses to approve a copy of an invoice that is already accepted', async () => {
    const { service } = setup();
    await service.submit(SOURCE, 'key-00000001');
    const copy = await service.submit(`${SOURCE}\nresent`, 'key-00000002');

    await expect(service.approve(copy.id, 1, null)).rejects.toThrow(IllegalTransitionError);
    expect((await service.reject(copy.id, 1, 'sent twice')).status).toBe('REJECTED');
  });

  it('lets a person approve or reject only what waits for review, at the version they saw', async () => {
    const { service } = setup(() => Promise.resolve({ reply: invoice({ dueDate: '2027-01-30' }), usage }));
    const waiting = await service.submit(SOURCE, 'key-00000001');

    await expect(service.approve(waiting.id, 7, null)).rejects.toThrow(VersionMismatchError);
    const approved = await service.approve(waiting.id, 1, 'agreed 90 days with this supplier');
    expect(approved).toMatchObject({ status: 'APPROVED', version: 2, note: 'agreed 90 days with this supplier' });
    await expect(service.reject(waiting.id, 2, 'changed my mind')).rejects.toThrow(IllegalTransitionError);
  });

  it('lists the review queue', async () => {
    const { service } = setup(() => Promise.resolve({ reply: invoice({ supplierKvk: null }), usage }));
    const waiting = await service.submit(SOURCE, 'key-00000001');

    expect((await service.reviewQueue(10)).map((record) => record.id)).toEqual([waiting.id]);
  });
});
