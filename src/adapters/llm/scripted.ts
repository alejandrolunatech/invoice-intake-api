import { ExtractorUnavailableError, type InvoiceExtractor, type ModelUsage } from '../../application/ports.js';

/**
 * NOT A LANGUAGE MODEL. A deterministic stand-in so the API runs offline, in tests and in CI,
 * without a key or cost. It reads only invoices written as "Label: value" lines and item lines
 * like "2 x Consulting @ 95.00 VAT 21%". Its results say nothing about a real model.
 *
 * Demo hook: an invoice containing "#outage" fails like a model outage.
 */
export class ScriptedExtractor implements InvoiceExtractor {
  static readonly NAME = 'scripted-stand-in';

  extract(sourceText: string): Promise<{ reply: unknown; usage: ModelUsage }> {
    if (sourceText.includes('#outage')) {
      return Promise.reject(new ExtractorUnavailableError('scripted outage'));
    }
    const field = (...labels: string[]): string | null => {
      for (const label of labels) {
        const match = new RegExp(`^\\s*${label}\\s*:\\s*(.+?)\\s*$`, 'im').exec(sourceText);
        if (match?.[1]) {
          return match[1];
        }
      }
      return null;
    };
    const amount = (text: string | null) => text?.replace(/[€\s]|EUR/g, '').replace(',', '.') ?? '';
    const lines = [...sourceText.matchAll(/^\s*([\d.,]+)\s*x\s+(.+?)\s+@\s*€?\s*([\d.,]+)\s+(?:VAT|BTW)\s+(\d{1,2})%\s*$/gim)]
      .map(([, quantity = '', description = '', unitPrice = '', rate = '0']) => ({
        description, quantity: quantity.replace(',', '.'), unitPrice: amount(unitPrice), vatRate: Number(rate),
      }));
    const reply = {
      supplierName: field('Supplier', 'Leverancier') ?? '',
      supplierKvk: field('KvK', 'Chamber of Commerce'),
      supplierVatId: field('VAT id', 'VAT', 'BTW-id', 'BTW'),
      supplierIban: field('IBAN'),
      invoiceNumber: field('Invoice number', 'Factuurnummer') ?? '',
      issueDate: field('Invoice date', 'Factuurdatum', 'Date') ?? '',
      dueDate: field('Due date', 'Vervaldatum'),
      currency: 'EUR',
      lines,
      totalNet: amount(field('Subtotal', 'Total excl. VAT', 'Totaal excl. btw')),
      totalVat: amount(field('VAT total', 'VAT amount', 'Btw-bedrag')),
      totalGross: amount(field('Total', 'Total incl. VAT', 'Totaal incl. btw')),
    };
    return Promise.resolve({
      reply,
      usage: { model: ScriptedExtractor.NAME, inputTokens: Math.ceil(sourceText.length / 4), outputTokens: 150, latencyMs: 0 },
    });
  }
}
