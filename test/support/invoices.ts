import type { ExtractedInvoice } from '../../src/domain/invoice.js';

/**
 * Made-up identifiers that pass their checksums. They were generated for these tests and do not
 * belong to any real company or account.
 */
export const IDS = {
  kvk: '81234567',
  vatElfproef: 'NL797543235B01',
  vatMod97: 'NL075291703B62',
  iban: 'NL84ABNA5260181590',
  iban2: 'NL48INGB8301661318',
} as const;

export const SOURCE = `Supplier: Hoorn Web Studio BV
KvK: ${IDS.kvk}
VAT id: ${IDS.vatElfproef}
IBAN: ${IDS.iban}
Invoice number: 2026-0042
Invoice date: 2026-10-01
Due date: 2026-10-31

2 x Website maintenance (hours) @ 95.00 VAT 21%
1 x Hosting October @ 25.00 VAT 21%

Subtotal: 215.00
VAT total: 45.15
Total: 260.15
`;

/** The fields a correct reading of {@link SOURCE} gives. */
export function invoice(overrides: Partial<ExtractedInvoice> = {}): ExtractedInvoice {
  return {
    supplierName: 'Hoorn Web Studio BV',
    supplierKvk: IDS.kvk,
    supplierVatId: IDS.vatElfproef,
    supplierIban: IDS.iban,
    invoiceNumber: '2026-0042',
    issueDate: '2026-10-01',
    dueDate: '2026-10-31',
    currency: 'EUR',
    lines: [
      { description: 'Website maintenance (hours)', quantity: '2', unitPrice: '95.00', vatRate: 21 },
      { description: 'Hosting October', quantity: '1', unitPrice: '25.00', vatRate: 21 },
    ],
    totalNet: '215.00',
    totalVat: '45.15',
    totalGross: '260.15',
    ...overrides,
  };
}
