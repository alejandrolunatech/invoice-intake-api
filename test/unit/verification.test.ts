import { describe, expect, it } from 'vitest';
import type { CheckCode } from '../../src/domain/invoice.js';
import { verify } from '../../src/domain/verification.js';
import { IDS, SOURCE, invoice } from '../support/invoices.js';

const TODAY = '2026-10-21';

function failed(...args: Parameters<typeof verify>): CheckCode[] {
  return verify(...args).filter((check) => !check.passed).map((check) => check.code);
}

describe('verify', () => {
  it('passes a consistent invoice that matches its source', () => {
    expect(failed(invoice(), SOURCE, TODAY)).toEqual([]);
  });

  it('catches totals that do not add up', () => {
    expect(failed(invoice({ totalNet: '215.01' }), SOURCE, TODAY)).toContain('LINES_ADD_UP');
    expect(failed(invoice({ totalVat: '47.00' }), SOURCE, TODAY)).toContain('VAT_ADDS_UP');
    expect(failed(invoice({ totalGross: '260.16' }), SOURCE, TODAY)).toContain('GROSS_ADDS_UP');
  });

  it('tolerates a cent of VAT rounding per line, and no more', () => {
    expect(failed(invoice({ totalVat: '45.17', totalGross: '260.17' }), SOURCE, TODAY)).toEqual([]);
    expect(failed(invoice({ totalVat: '45.18', totalGross: '260.18' }), SOURCE, TODAY)).toEqual(['VAT_ADDS_UP']);
  });

  it('refuses a VAT rate the Netherlands does not use', () => {
    const lines = invoice().lines.map((line) => ({ ...line, vatRate: 19 }));
    expect(failed(invoice({ lines }), SOURCE, TODAY)).toContain('VAT_RATES_ALLOWED');
  });

  it('refuses amounts it cannot read, instead of guessing', () => {
    expect(failed(invoice({ totalNet: '1.250,00' }), SOURCE, TODAY)).toEqual(['AMOUNTS_READABLE']);
    expect(failed(invoice({ lines: [] }), SOURCE, TODAY)).toEqual(['AMOUNTS_READABLE']);
  });

  it('checks identifiers by checksum', () => {
    expect(failed(invoice({ supplierIban: 'NL84ABNA5260181591' }), SOURCE.replace(IDS.iban, 'NL84ABNA5260181591'), TODAY))
      .toEqual(['SUPPLIER_IBAN']);
    expect(failed(invoice({ supplierKvk: null }), SOURCE, TODAY)).toEqual(['SUPPLIER_KVK']);
  });

  it('refuses an identifier the model did not find in the source', () => {
    expect(failed(invoice({ supplierIban: IDS.iban2 }), SOURCE, TODAY)).toEqual(['FOUND_IN_SOURCE']);
    expect(verify(invoice({ supplierIban: IDS.iban2 }), SOURCE, TODAY).find((c) => c.code === 'FOUND_IN_SOURCE')?.detail)
      .toBe('not in the source: IBAN');
  });

  it('checks dates and the payment term', () => {
    expect(failed(invoice({ issueDate: '2026-10-22', dueDate: '2026-11-01' }), SOURCE, TODAY)).toEqual(['ISSUE_DATE_NOT_IN_FUTURE']);
    expect(failed(invoice({ dueDate: '2026-09-30' }), SOURCE, TODAY)).toEqual(['DUE_DATE_VALID']);
    expect(failed(invoice({ dueDate: '2026-12-01' }), SOURCE, TODAY)).toEqual(['DUE_DATE_VALID']);
    expect(failed(invoice({ dueDate: null }), SOURCE, TODAY)).toEqual([]);
    expect(failed(invoice({ issueDate: '1 Oct 2026' }), SOURCE, TODAY)).toEqual(['ISSUE_DATE_NOT_IN_FUTURE']);
    expect(failed(invoice({ issueDate: '2026-02-30', dueDate: null }), SOURCE, TODAY)).toEqual(['ISSUE_DATE_NOT_IN_FUTURE']);
    expect(failed(invoice({ dueDate: '2026-10-32' }), SOURCE, TODAY)).toEqual(['DUE_DATE_VALID']);
  });

  it('refuses another currency', () => {
    expect(failed(invoice({ currency: 'USD' }), SOURCE, TODAY)).toEqual(['CURRENCY_EUR']);
  });

  it('never quotes the source text in its details', () => {
    const details = verify(invoice({ supplierIban: IDS.iban2 }), SOURCE, TODAY).map((c) => c.detail).join(' ');
    expect(details).not.toContain('Hoorn Web Studio');
    expect(details).not.toContain(IDS.iban2);
  });
});
