import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import admin from 'firebase-admin';
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
  private static instance: admin.app.App;
  private messaging: any;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.initializeFirebase();
  }

  /**
   * Initialize Firebase Admin SDK.
   * Called automatically when the module is initialized.
   */
  private async initializeFirebase(): Promise<void> {
    try {
      // Return existing instance if already initialized
      if (FirebaseAdminService.instance) {
        this.logger.log('Firebase Admin SDK already initialized');
        this.messaging = FirebaseAdminService.instance.messaging();
        return;
      }

      const serviceAccountJson = this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT');
      
      if (!serviceAccountJson) {
        this.logger.warn('FIREBASE_SERVICE_ACCOUNT not set in environment variables');
        this.logger.warn('Push notifications will be disabled');
        return;
      }

      const serviceAccount = JSON.parse(serviceAccountJson);

      FirebaseAdminService.instance = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
      });

      this.messaging = FirebaseAdminService.instance.messaging();
      this.logger.log('Firebase Admin SDK initialized successfully');
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
