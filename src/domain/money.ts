/**
 * Money is an integer number of cents, never a float: 0.1 + 0.2 is not 0.3 in floating point,
 * and an invoice that is off by a cent is wrong.
 */
export type Cents = number;

const AMOUNT = /^(-?)(\d{1,12})(?:\.(\d{1,2}))?$/;

/** Parses "1234.5" or "1234.56" into cents. Returns undefined for anything else. */
export function parseAmount(text: string): Cents | undefined {
  const match = AMOUNT.exec(text.trim());
  if (!match) {
    return undefined;
  }
  const [, sign, whole = '0', fraction = ''] = match;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return sign === '-' ? -cents : cents;
}

export function formatCents(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

const QUANTITY = /^(\d{1,9})(?:\.(\d{1,3}))?$/;

/** A quantity such as "1.5" (hours) as thousandths, so it can be multiplied without floats. */
export function parseQuantity(text: string): number | undefined {
  const match = QUANTITY.exec(text.trim());
  if (!match) {
    return undefined;
  }
  const [, whole = '0', fraction = ''] = match;
  return Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
}

/** Integer division rounded half away from zero, as amounts on invoices are rounded. */
export function divideRounded(numerator: number, denominator: number): number {
  const quotient = Math.trunc(numerator / denominator);
  const remainder = numerator - quotient * denominator;
  if (Math.abs(remainder) * 2 >= Math.abs(denominator)) {
    return quotient + Math.sign(numerator) * Math.sign(denominator);
  }
  return quotient;
}

/** quantity (thousandths) x unit price (cents), rounded to the cent. */
export function lineNet(quantityThousandths: number, unitPrice: Cents): Cents {
  return divideRounded(quantityThousandths * unitPrice, 1000);
}

/** VAT on a net amount at a whole-percent rate, rounded to the cent. */
export function vatOn(net: Cents, ratePercent: number): Cents {
  return divideRounded(net * ratePercent, 100);
}
