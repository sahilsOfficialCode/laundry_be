import * as crypto from 'crypto';

/**
 * Referral-code generation utilities.
 *
 * Codes are:
 *  - Uppercase, human-readable (ambiguous chars 0/O/1/I removed)
 *  - Cryptographically random (crypto.randomInt, not Math.random)
 *  - Uniqueness is enforced by the caller against the DB (retry on collision)
 */

// Crockford-ish alphabet without easily-confused characters.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFAULT_LENGTH = 7;

/** Generate a single random code of the given length (default 7). */
export function generateReferralCode(length = DEFAULT_LENGTH): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }
  return code;
}

/**
 * Build a "vanity" code from a name/handle plus random digits,
 * e.g. deriveVanityCode('Vipin') -> 'VIPIN' + 2 digits = 'VIPIN73'.
 * Falls back to a fully random code when the seed has too few usable chars.
 */
export function deriveVanityCode(seed: string, totalLength = DEFAULT_LENGTH): string {
  const cleaned = (seed || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, Math.max(0, totalLength - 2));

  if (cleaned.length < 3) return generateReferralCode(totalLength);

  const remaining = totalLength - cleaned.length;
  let suffix = '';
  for (let i = 0; i < remaining; i++) {
    suffix += crypto.randomInt(0, 10).toString();
  }
  return cleaned + suffix;
}

/** Normalise user-supplied codes (trim + uppercase) before comparison. */
export function normalizeCode(code: string): string {
  return (code || '').trim().toUpperCase();
}

/** Basic shape check before hitting the DB. */
export function isValidCodeFormat(code: string): boolean {
  return /^[A-Z0-9]{4,16}$/.test(normalizeCode(code));
}
