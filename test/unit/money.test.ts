import { describe, expect, it } from 'vitest';
import { divideRounded, formatCents, lineNet, parseAmount, parseQuantity, vatOn } from '../../src/domain/money.js';

describe('money', () => {
  it('parses plain amounts into cents', () => {
    expect(parseAmount('1250')).toBe(125_000);
    expect(parseAmount('1250.5')).toBe(125_050);
    expect(parseAmount(' 0.07 ')).toBe(7);
    expect(parseAmount('-3.10')).toBe(-310);
  });

  it('refuses what is not a plain amount', () => {
    for (const text of ['1.250,00', '€ 12', '12.345', '1e3', '', 'abc']) {
      expect(parseAmount(text)).toBeUndefined();
    }
  });

  it('formats cents back', () => {
    expect(formatCents(125_050)).toBe('1250.50');
    expect(formatCents(-7)).toBe('-0.07');
  });

  it('rounds half away from zero, without floats', () => {
    expect(divideRounded(5, 10)).toBe(1);
    expect(divideRounded(-5, 10)).toBe(-1);
    expect(divideRounded(4, 10)).toBe(0);
    // 0.1 + 0.2 style trouble cannot happen: 3 x 0.10 is exactly 30 cents.
    expect(lineNet(parseQuantity('3') ?? 0, 10)).toBe(30);
  });

  it('multiplies fractional quantities and rounds to the cent', () => {
    expect(lineNet(parseQuantity('1.5') ?? 0, 9_500)).toBe(14_250);
    expect(lineNet(parseQuantity('0.333') ?? 0, 100)).toBe(33);
  });

  it('computes VAT at whole-percent rates', () => {
    expect(vatOn(21_500, 21)).toBe(4_515);
    expect(vatOn(1_005, 9)).toBe(90);
    expect(vatOn(12_345, 0)).toBe(0);
  });
});
