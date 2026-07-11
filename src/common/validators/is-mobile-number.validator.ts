import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import type { CountryCode } from 'libphonenumber-js';
// Use the "mobile" metadata bundle so validation is mobile-specific and strict
// (e.g. an Indian number must start 6-9; landlines are rejected).
import {
  isValidPhoneNumber,
  parsePhoneNumberFromString,
} from 'libphonenumber-js/mobile';

/**
 * Default region used to interpret numbers typed without a country code
 * (e.g. a bare 10-digit Indian mobile). Overridable via env.
 */
export const DEFAULT_PHONE_REGION = (process.env.DEFAULT_PHONE_REGION ||
  'IN') as CountryCode;

@ValidatorConstraint({ name: 'isMobileNumber', async: false })
export class IsMobileNumberConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!trimmed) return false;

    // Accept either a full international number (+<country><number>)
    // or a national number valid in the configured default region.
    return (
      isValidPhoneNumber(trimmed) ||
      isValidPhoneNumber(trimmed, DEFAULT_PHONE_REGION)
    );
  }

  defaultMessage(): string {
    return 'mobileNumber must be a valid mobile phone number';
  }
}

/**
 * Standard mobile-number validation backed by Google's libphonenumber.
 * Usage: `@IsMobileNumber()` on a DTO property.
 */
export function IsMobileNumber(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsMobileNumberConstraint,
    });
  };
}

/**
 * Normalize any accepted input to canonical E.164 (e.g. +919876543210).
 * Returns null when the value cannot be parsed as a valid number.
 */
export function toE164(
  value: string,
  region: CountryCode = DEFAULT_PHONE_REGION,
): string | null {
  const parsed = parsePhoneNumberFromString(value.trim(), region);
  return parsed && parsed.isValid() ? parsed.number : null;
}
