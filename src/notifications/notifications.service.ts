import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';

/**
 * NotificationsService
 * --------------------
 * Sends push notifications via Firebase Cloud Messaging (FCM) HTTP v1 API.
 *
 * SETUP REQUIRED:
 *   1. Create a Firebase project at https://console.firebase.google.com
 *   2. Add your Android app (package name from AndroidManifest.xml) and
 *      download google-services.json → place in laundry_fe/android/app/
 *   3. Add your iOS app and download GoogleService-Info.plist → place in
 *      laundry_fe/ios/Runner/
 *   4. In Firebase Console → Project Settings → Service Accounts → Generate
 *      new private key → save as firebase-service-account.json
 *   5. Set the following environment variables on the backend:
 *        FIREBASE_PROJECT_ID=your-project-id
 *        FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@your-project-id.iam.gserviceaccount.com
 *        FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
 *   6. Install firebase-admin:  npm install firebase-admin
 *   7. Uncomment the firebase-admin imports and implementation below.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  /**
   * Send a push notification to a specific user identified by their userId.
   * Looks up their FCM token from the database and calls FCM.
   */
  async sendToUser(
    userId: string,
    payload: { title: string; body: string; data?: Record<string, string> },
  ): Promise<void> {
    try {
      const user = await this.userModel.findById(userId).select('fcmToken').lean();
      const token = user?.fcmToken;
      if (!token) {
        this.logger.debug(`No FCM token for user ${userId} — skipping push`);
        return;
      }

      await this.sendFcm(token, payload);
    } catch (err) {
      this.logger.warn(`Push notification failed for user ${userId}: ${(err as Error).message}`);
    }
  }

  /**
   * Low-level FCM send via the Legacy HTTP API.
   *
   * Replace this with firebase-admin once you've configured your service
   * account credentials (see SETUP REQUIRED above).
   *
   * For now it logs the notification payload so you can verify it's being
   * called correctly during development.
   */
  private async sendFcm(
    token: string,
    payload: { title: string; body: string; data?: Record<string, string> },
  ): Promise<void> {
    const serverKey = process.env.FCM_SERVER_KEY;

    if (!serverKey) {
      // Gracefully skip — log at debug level so it doesn't spam production logs
      this.logger.debug(
        `FCM_SERVER_KEY not set — notification skipped. Payload: ${JSON.stringify(payload)}`,
      );
      return;
    }

    const body = JSON.stringify({
      to: token,
      notification: { title: payload.title, body: payload.body },
      data: payload.data ?? {},
      priority: 'high',
    });

    const response = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `key=${serverKey}`,
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      this.logger.warn(`FCM HTTP error ${response.status}: ${text}`);
    } else {
      this.logger.log(`Push sent to token ${token.slice(0, 12)}…`);
    }
  }

  // ── Convenience helpers ──────────────────────────────────────────────────────

  async notifyOrderStatus(
    userId: string,
    orderNumber: string,
    status: string,
  ): Promise<void> {
    const messages: Record<string, { title: string; body: string }> = {
      ORDER_PLACED:     { title: 'Order Confirmed! 🎉',     body: `Order #${orderNumber} has been placed successfully.` },
      PICKUP_ASSIGNED:  { title: 'Pickup Assigned 🛵',      body: `A rider is on the way to pick up your clothes for Order #${orderNumber}.` },
      ITEMIZED:         { title: 'Clothes Counted ✅',       body: `Your clothes for Order #${orderNumber} have been itemized. Bill will be confirmed shortly.` },
      PROCESSING:       { title: 'Cleaning in Progress 🧺', body: `Your clothes for Order #${orderNumber} are being cleaned. Please complete your payment.` },
      OUT_FOR_DELIVERY: { title: 'Out for Delivery 🚀',     body: `Your fresh clothes are on the way! Share your OTP when the rider arrives for Order #${orderNumber}.` },
      COMPLETED:        { title: 'Delivered! 🎊',           body: `Order #${orderNumber} has been delivered successfully. Thank you for choosing LaundryBrew!` },
      CANCELLED:        { title: 'Order Cancelled',         body: `Order #${orderNumber} has been cancelled. Contact support if you need help.` },
    };

    const msg = messages[status];
    if (msg) {
      await this.sendToUser(userId, { ...msg, data: { orderNumber, status } });
    }
  }

  async notifyPaymentSuccess(userId: string, orderNumber: string): Promise<void> {
    await this.sendToUser(userId, {
      title: 'Payment Successful 💳',
      body: `Payment confirmed for Order #${orderNumber}. Your delivery OTP is ready in the app.`,
      data: { orderNumber, event: 'PAYMENT_SUCCESS' },
    });
  }
}
