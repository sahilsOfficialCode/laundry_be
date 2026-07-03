import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { initializeApp, getApp, getApps, cert, App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { ConfigService } from '@nestjs/config';

/**
 * FirebaseAdminService
 * --------------------
 * Singleton service for Firebase Admin SDK initialization.
 * Provides access to Firebase Messaging for sending push notifications.
 *
 * This service initializes Firebase Admin SDK once and provides
 * the messaging instance throughout the application.
 */
@Injectable()
export class FirebaseAdminService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseAdminService.name);
  private static instance: App;
  private messaging: any;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.initializeFirebase();
  }

  /**
   * Initialize Firebase Admin SDK.
   * Called automatically when the module is initialized.
   *
   * Uses getApps() to check if Firebase Admin SDK is already initialized.
   * This prevents duplicate initialization errors during NestJS hot reload.
   */
  private async initializeFirebase(): Promise<void> {
    try {
      // Return existing instance if already initialized in this class
      if (FirebaseAdminService.instance && this.messaging) {
        this.logger.log('Firebase Admin SDK already initialized (class instance)');
        return;
      }

      const serviceAccountJson = this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT');

      if (!serviceAccountJson) {
        this.logger.warn('FIREBASE_SERVICE_ACCOUNT not set in environment variables');
        this.logger.warn('Push notifications will be disabled');
        return;
      }

      const serviceAccount = JSON.parse(serviceAccountJson);

      // Check if Firebase Admin SDK is already initialized globally
      // This handles NestJS hot reload scenarios where the class is reloaded
      // but Firebase's internal app registry still has the app
      if (getApps().length === 0) {
        // No apps initialized, create new one
        this.logger.log('Initializing Firebase Admin SDK');
        FirebaseAdminService.instance = initializeApp({
          credential: cert(serviceAccount),
        });
      } else {
        // App already exists in Firebase's internal registry
        // Get the default app to avoid duplicate initialization error
        this.logger.log('Firebase Admin SDK already initialized (global registry), reusing existing app');
        FirebaseAdminService.instance = getApp();
      }

      this.messaging = getMessaging(FirebaseAdminService.instance);
      this.logger.log('Firebase Admin SDK ready');
    } catch (error) {
      this.logger.error('Failed to initialize Firebase Admin SDK:', error);
      throw error;
    }
  }

  /**
   * Get Firebase Messaging instance.
   * Throws error if Firebase is not initialized.
   */
  getMessaging(): any {
    if (!this.messaging) {
      throw new Error('Firebase Messaging not initialized. Check FIREBASE_SERVICE_ACCOUNT environment variable.');
    }
    return this.messaging;
  }

  /**
   * Check if Firebase Admin SDK is initialized.
   */
  isInitialized(): boolean {
    return !!this.messaging;
  }
}
