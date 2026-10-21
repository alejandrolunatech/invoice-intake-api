import { compact, isDutchVatId, isIban, isKvkNumber } from './identifiers.js';
import { type ExtractedInvoice, type CheckResult, type CheckCode, ALLOWED_VAT_RATES } from './invoice.js';
import { formatCents, lineNet, parseAmount, parseQuantity, vatOn } from './money.js';

/** Our made-up payment policy: an invoice may ask for payment within at most 60 days. */
export const MAX_PAYMENT_TERM_DAYS = 60;

const DAY_MS = 86_400_000;

/**
 * The time of a real calendar date written as YYYY-MM-DD, or undefined. Date.parse alone would
 * turn 2026-02-30 into 2 March, so the parsed date must give back the same text.
 */
function calendarDate(text: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return undefined;
  }
  const time = Date.parse(`${text}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === text ? time : undefined;
}

function result(code: CheckCode, passed: boolean, detail: string): CheckResult {
  return { code, passed, detail };
}

/**
 * Every check on extracted fields, in plain code. The model's output is a claim; these checks
 * decide whether the claim is consistent, well formed and actually in the source document.
 * Details never quote the source text, only field names and amounts.
 */
export function verify(invoice: ExtractedInvoice, sourceText: string, today: string): CheckResult[] {
  return [
    result('CURRENCY_EUR', invoice.currency === 'EUR', `currency is ${invoice.currency === 'EUR' ? 'EUR' : 'not EUR'}`),
    checkIdentifier('SUPPLIER_KVK', invoice.supplierKvk, isKvkNumber, 'KvK number'),
    checkIdentifier('SUPPLIER_VAT_ID', invoice.supplierVatId, isDutchVatId, 'VAT id'),
    checkIdentifier('SUPPLIER_IBAN', invoice.supplierIban, isIban, 'IBAN'),
    ...checkAmounts(invoice),
    ...checkDates(invoice, today),
    checkFoundInSource(invoice, sourceText),
  ];
}

function checkIdentifier(code: CheckCode, value: string | null, isValid: (text: string) => boolean,
                         name: string): CheckResult {
  if (value === null) {
    return result(code, false, `${name} missing`);
  }
  const valid = isValid(value);
  return result(code, valid, valid ? `${name} well formed` : `${name} malformed or checksum fails`);
}

function checkAmounts(invoice: ExtractedInvoice): CheckResult[] {
  const net = parseAmount(invoice.totalNet);
  const vat = parseAmount(invoice.totalVat);
  const gross = parseAmount(invoice.totalGross);
  const lines = invoice.lines.map((line) => ({
    quantity: parseQuantity(line.quantity),
    unitPrice: parseAmount(line.unitPrice),
    rate: line.vatRate,
  }));
  const unreadable = net === undefined || vat === undefined || gross === undefined || invoice.lines.length === 0
    || lines.some((line) => line.quantity === undefined || line.unitPrice === undefined);
  if (unreadable) {
    return [result('AMOUNTS_READABLE', false, 'a total, quantity or price is missing or not a plain amount')];
  }
  const rates = lines.map((line) => line.rate);
  const badRate = rates.find((rate) => !ALLOWED_VAT_RATES.includes(rate));

  const nets = lines.map((line) => lineNet(line.quantity ?? 0, line.unitPrice ?? 0));
  const computedNet = nets.reduce((sum, value) => sum + value, 0);
  // VAT per rate, on the summed net of that rate. Invoices that round per line may differ by up
  // to a cent per line, so that much is tolerated.
  const netPerRate = new Map<number, number>();
  nets.forEach((value, i) => {
    const rate = rates[i] ?? 0;
    netPerRate.set(rate, (netPerRate.get(rate) ?? 0) + value);
  });
  const computedVat = [...netPerRate].reduce((sum, [rate, rateNet]) => sum + vatOn(rateNet, rate), 0);
  const tolerance = lines.length;

  return [
    result('AMOUNTS_READABLE', true, 'all amounts readable'),
    result('VAT_RATES_ALLOWED', badRate === undefined,
      badRate === undefined ? 'VAT rates are 21, 9 or 0' : `VAT rate ${badRate}% is not allowed`),
    result('LINES_ADD_UP', computedNet === net,
      `lines add up to ${formatCents(computedNet)}, invoice says ${formatCents(net)}`),
    result('VAT_ADDS_UP', Math.abs(computedVat - vat) <= tolerance,
      `VAT should be ${formatCents(computedVat)}, invoice says ${formatCents(vat)}`),
    result('GROSS_ADDS_UP', net + vat === gross,
      `net plus VAT is ${formatCents(net + vat)}, invoice says ${formatCents(gross)}`),
  ];
}

function checkDates(invoice: ExtractedInvoice, today: string): CheckResult[] {
  const issued = calendarDate(invoice.issueDate);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (issued === undefined) {
    return [result('ISSUE_DATE_NOT_IN_FUTURE', false, 'issue date missing or not a date')];
  }
  const checks = [result('ISSUE_DATE_NOT_IN_FUTURE', issued <= now,
    issued <= now ? 'issue date is not in the future' : 'issue date is in the future')];
  if (invoice.dueDate === null) {
    return [...checks, result('DUE_DATE_VALID', true, 'no due date; the default term applies')];
  }
  const due = calendarDate(invoice.dueDate);
  if (due === undefined) {
    return [...checks, result('DUE_DATE_VALID', false, 'due date is not a date')];
  }
  const termDays = Math.round((due - issued) / DAY_MS);
  const valid = termDays >= 0 && termDays <= MAX_PAYMENT_TERM_DAYS;
  return [...checks, result('DUE_DATE_VALID', valid,
    valid ? `payment term ${termDays} days` : `payment term ${termDays} days is outside 0 to ${MAX_PAYMENT_TERM_DAYS}`)];
}

/**
 * The model could invent an IBAN or an invoice number that looks right. Each identifier it
 * returns must appear in the source text, ignoring spaces, dots and case.
 */
function checkFoundInSource(invoice: ExtractedInvoice, sourceText: string): CheckResult {
  const source = compact(sourceText);
  const identifiers: [string, string | null][] = [
    ['invoice number', invoice.invoiceNumber],
    ['KvK number', invoice.supplierKvk],
    ['VAT id', invoice.supplierVatId],
    ['IBAN', invoice.supplierIban],
  ];
  const missing = identifiers
    .filter(([, value]) => value !== null && value.trim() !== '' && !source.includes(compact(value)))
    .map(([name]) => name);
  return result('FOUND_IN_SOURCE', missing.length === 0,
    missing.length === 0 ? 'every identifier appears in the source' : `not in the source: ${missing.join(', ')}`);
}
