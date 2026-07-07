import { Injectable, UnauthorizedException } from '@nestjs/common';
import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getAuth, DecodedIdToken } from 'firebase-admin/auth';
import { toE164 } from '../../common/validators/is-mobile-number.validator';

@Injectable()
export class FirebaseAdminService {
  private app: App;
  private auth: ReturnType<typeof getAuth>;

  constructor() {
    this.initializeFirebase();
  }

  private initializeFirebase() {
    try {
      // Check if Firebase is already initialized
      const existingApps = getApps();
      if (existingApps.length > 0) {
        this.app = existingApps[0];
        this.auth = getAuth(this.app);
        return;
      }

      // Initialize Firebase Admin with service account from environment
      const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
      
      if (!serviceAccountJson) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT environment variable is not set');
      }

      let serviceAccount;
      try {
        serviceAccount = JSON.parse(serviceAccountJson);
      } catch (parseError) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON');
      }

      // Validate required fields
      const requiredFields = [
        'type',
        'project_id',
        'private_key_id',
        'private_key',
        'client_email',
        'client_id',
        'auth_uri',
        'token_uri',
        'auth_provider_x509_cert_url',
        'client_x509_cert_url',
      ];

      const missingFields = requiredFields.filter(field => !serviceAccount[field]);
      if (missingFields.length > 0) {
        throw new Error(
          `FIREBASE_SERVICE_ACCOUNT missing required fields: ${missingFields.join(', ')}`,
        );
      }

      this.app = initializeApp({
        credential: cert(serviceAccount),
      });
      this.auth = getAuth(this.app);
    } catch (error) {
      console.error('Failed to initialize Firebase Admin:', error);
      throw new Error(`Firebase Admin initialization failed: ${error.message}`);
    }
  }

  /**
   * Verify Firebase ID token and return decoded token
   */
  async verifyIdToken(idToken: string): Promise<DecodedIdToken> {
    try {
      const decodedToken = await this.auth.verifyIdToken(idToken);
      return decodedToken;
    } catch (error) {
      console.error('Firebase token verification failed:', error);
      throw new UnauthorizedException('Invalid Firebase ID token');
    }
  }

  /**
   * Extract phone number from Firebase token
   */
  extractPhoneNumber(decodedToken: DecodedIdToken): string | null {
    return decodedToken.phone_number || null;
  }

  /**
   * Normalize a phone number to canonical E.164 format (e.g. +919876543210).
   *
   * Uses libphonenumber to correctly interpret national-format numbers
   * (e.g. a bare 10-digit Indian mobile becomes +91XXXXXXXXXX). Falls back to
   * a plain "+<digits>" form only when the number cannot be parsed, preserving
   * the previous behaviour for already-normalized inputs.
   */
  normalizePhoneNumber(phoneNumber: string): string {
    const e164 = toE164(phoneNumber);
    if (e164) return e164;

    // Fallback: strip non-digits and prefix '+' (legacy behaviour).
    const digitsOnly = phoneNumber.replace(/\D/g, '');
    return '+' + digitsOnly;
  }

  /**
   * Compare two phone numbers for equality
   * Handles different formats (with/without +, with/without spaces)
   */
  phoneNumbersMatch(phone1: string, phone2: string): boolean {
    const normalized1 = this.normalizePhoneNumber(phone1);
    const normalized2 = this.normalizePhoneNumber(phone2);
    return normalized1 === normalized2;
  }
}
