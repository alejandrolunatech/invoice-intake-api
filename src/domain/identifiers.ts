/**
 * Format and checksum checks for Dutch business identifiers. They prove a number is well formed,
 * not that it exists: a real service would also look the KvK number up in the trade register and
 * the VAT number up in the EU's VIES service.
 */

/** Removes spaces and dots, the way people write these numbers by hand, and uppercases. */
export function compact(text: string): string {
  return text.replace(/[\s.]/g, '').toUpperCase();
}

/** A KvK (Chamber of Commerce) number is eight digits. */
export function isKvkNumber(text: string): boolean {
  return /^\d{8}$/.test(compact(text));
}

/** Reduces a long digit string modulo 97 in chunks, so it never overflows a number. */
function mod97(digits: string): number {
  let remainder = 0;
  for (let i = 0; i < digits.length; i += 7) {
    remainder = Number(String(remainder) + digits.slice(i, i + 7)) % 97;
  }
  return remainder;
}

/** Letters become two-digit numbers: A = 10 ... Z = 35, as ISO 7064 asks. */
function lettersToDigits(text: string): string {
  return text.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
}

/** IBAN lengths of the SEPA countries. An IBAN from any other country is refused, not guessed at. */
const IBAN_LENGTHS: Readonly<Record<string, number>> = {
  AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20, ES: 24, FI: 18, FR: 27, GB: 22,
  GI: 23, GR: 27, HR: 21, HU: 28, IE: 22, IS: 26, IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MT: 31, NL: 18,
  NO: 15, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19, SK: 24, SM: 27, VA: 22,
};

/** ISO 13616: country code, two check digits, then the account; the whole thing mod 97 is 1. */
export function isIban(text: string): boolean {
  const iban = compact(text);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) {
    return false;
  }
  const expectedLength = IBAN_LENGTHS[iban.slice(0, 2)];
  if (iban.length !== expectedLength) {
    return false;
  }
  return mod97(lettersToDigits(iban.slice(4) + iban.slice(0, 4))) === 1;
}

/**
 * A Dutch VAT identification number: NL, nine digits, B, two digits. Older numbers pass the
 * "elfproef" (mod 11) on the nine digits; numbers issued since 2020 pass a mod 97 check over
 * the whole number instead. Either one is accepted.
 */
export function isDutchVatId(text: string): boolean {
  const vatId = compact(text);
  const match = /^NL(\d{9})B(\d{2})$/.exec(vatId);
  if (!match) {
    return false;
  }
  const digits = match[1] ?? '';
  return passesElfproef(digits) || mod97(lettersToDigits(vatId)) === 1;
}

function passesElfproef(nineDigits: string): boolean {
  const weights = [9, 8, 7, 6, 5, 4, 3, 2, -1];
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += Number(nineDigits.charAt(i)) * (weights[i] ?? 0);
  }
  return sum % 11 === 0;
}
