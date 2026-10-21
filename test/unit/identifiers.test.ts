import { describe, expect, it } from 'vitest';
import { isDutchVatId, isIban, isKvkNumber } from '../../src/domain/identifiers.js';
import { IDS } from '../support/invoices.js';

describe('identifiers', () => {
  it('accepts a KvK number of eight digits, with or without spaces', () => {
    expect(isKvkNumber(IDS.kvk)).toBe(true);
    expect(isKvkNumber('8123 4567')).toBe(true);
    expect(isKvkNumber('8123456')).toBe(false);
    expect(isKvkNumber('8123456A')).toBe(false);
  });

  it('accepts an IBAN whose checksum holds, however it is spaced', () => {
    expect(isIban(IDS.iban)).toBe(true);
    expect(isIban('nl84 abna 5260 1815 90')).toBe(true);
  });

  it('refuses an IBAN with one digit changed, or the wrong length', () => {
    expect(isIban(IDS.iban.replace(/0$/, '1'))).toBe(false);
    expect(isIban(`${IDS.iban}0`)).toBe(false);
    expect(isIban('NL00')).toBe(false);
  });

  it('refuses an IBAN from a country it has no length for, even when the checksum holds', () => {
    expect(isIban('ZZ83ABCDEFGHIJ')).toBe(false);
    expect(isIban('DE89370400440532013000')).toBe(true);
  });

  it('accepts a VAT id that passes either the elfproef or the mod 97 check', () => {
    expect(isDutchVatId(IDS.vatElfproef)).toBe(true);
    expect(isDutchVatId(IDS.vatMod97)).toBe(true);
    expect(isDutchVatId('nl 7975.43235 b01')).toBe(true);
  });

  it('refuses a VAT id that passes neither, or has the wrong shape', () => {
    expect(isDutchVatId('NL797543236B01')).toBe(false);
    expect(isDutchVatId('NL79754323B01')).toBe(false);
    expect(isDutchVatId('BE0123456789')).toBe(false);
  });
});
