import { z } from 'zod';
import type { ExtractedInvoice } from '../domain/invoice.js';

/**
 * The contract the model must answer in. Amounts are strings so that no float ever touches
 * money; the domain parses them. The same schema is sent to the model as a JSON schema and used
 * to validate its reply, so the two cannot drift apart.
 */
export const extractionContract = z.strictObject({
  supplierName: z.string().min(1).max(200),
  supplierKvk: z.string().max(20).nullable(),
  supplierVatId: z.string().max(20).nullable(),
  supplierIban: z.string().max(40).nullable(),
  invoiceNumber: z.string().min(1).max(60),
  issueDate: z.string().describe('YYYY-MM-DD'),
  dueDate: z.string().nullable().describe('YYYY-MM-DD, or null when the invoice states none'),
  currency: z.string().length(3),
  lines: z.array(z.strictObject({
    description: z.string().max(300),
    quantity: z.string().describe('a plain number such as 1 or 1.5'),
    unitPrice: z.string().describe('excluding VAT, a plain number such as 1250.00'),
    vatRate: z.number().describe('a whole percentage such as 21'),
  })).min(1).max(100),
  totalNet: z.string().describe('excluding VAT, a plain number such as 1250.00'),
  totalVat: z.string(),
  totalGross: z.string(),
}) satisfies z.ZodType<ExtractedInvoice>;
