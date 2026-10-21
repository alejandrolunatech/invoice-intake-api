import type { Cents } from './money.js';

/** VAT rates that may appear on a Dutch invoice: standard, reduced, and zero (exempt or reverse charge). */
export const ALLOWED_VAT_RATES: readonly number[] = [21, 9, 0];

/** The fields read from an invoice, before any check. Amounts are still text, as the source wrote them. */
export interface ExtractedInvoice {
  readonly supplierName: string;
  readonly supplierKvk: string | null;
  readonly supplierVatId: string | null;
  readonly supplierIban: string | null;
  readonly invoiceNumber: string;
  readonly issueDate: string;
  readonly dueDate: string | null;
  readonly currency: string;
  readonly lines: readonly ExtractedLine[];
  readonly totalNet: string;
  readonly totalVat: string;
  readonly totalGross: string;
}

export interface ExtractedLine {
  readonly description: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly vatRate: number;
}

/** One check and its result. {@code code} is stable, so clients and dashboards can count them. */
export interface CheckResult {
  readonly code: CheckCode;
  readonly passed: boolean;
  readonly detail: string;
}

export type CheckCode =
  | 'CURRENCY_EUR'
  | 'SUPPLIER_KVK'
  | 'SUPPLIER_VAT_ID'
  | 'SUPPLIER_IBAN'
  | 'AMOUNTS_READABLE'
  | 'VAT_RATES_ALLOWED'
  | 'LINES_ADD_UP'
  | 'VAT_ADDS_UP'
  | 'GROSS_ADDS_UP'
  | 'ISSUE_DATE_NOT_IN_FUTURE'
  | 'DUE_DATE_VALID'
  | 'FOUND_IN_SOURCE'
  | 'NOT_A_DUPLICATE';

export interface Totals {
  readonly net: Cents;
  readonly vat: Cents;
  readonly gross: Cents;
}
