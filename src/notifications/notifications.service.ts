import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { FirebaseAdminService } from './firebase-admin.service';

/**
 * NotificationsService
 * --------------------
 * Production-ready push notification service using Firebase Admin SDK HTTP v1 API.
 * 
 * Features:
 * - Multi-device support (sends to all user's FCM tokens)
 * - Invalid token cleanup
 * - Retry-safe implementation
 * - Order status notifications
 * - Payment notifications
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private firebaseAdminService: FirebaseAdminService,
  ) {}

  /**
   * Send a push notification to a specific user.
   * Sends to all devices (all FCM tokens) registered for the user.
   * Automatically cleans up invalid tokens.
   */
  async sendToUser(
    userId: string,
    payload: {
      title: string;
      body: string;
      type?: string;
      orderId?: string;
      data?: Record<string, string>;
    },
  ): Promise<void> {
    try {
      if (!this.firebaseAdminService.isInitialized()) {
        this.logger.warn('Firebase Admin SDK not initialized, skipping notification');
        return;
      }

      const user = await this.userModel.findById(userId).select('fcmTokens').lean();
      const tokens = user?.fcmTokens || [];

      if (tokens.length === 0) {
        this.logger.debug(`No FCM tokens for user ${userId} — skipping push`);
        return;
      }

      const messaging = this.firebaseAdminService.getMessaging();

      // Prepare notification data
      const notificationData: Record<string, string> = {
        type: payload.type || 'general',
        orderId: payload.orderId || '',
        ...payload.data,
      };

      // Prepare notification
      const notificationPayload = {
        title: payload.title,
        body: payload.body,
      };

      // Send to all tokens
      const message = {
        tokens: tokens,
        notification: notificationPayload,
        data: notificationData,
        android: {
          priority: 'high' as const,
          notification: {
            channelId: 'laundry_brew_high_importance',
          },
        },
        apns: {
          payload: {
            aps: {
              alert: {
                title: payload.title,
                body: payload.body,
              },
              sound: 'default',
              badge: 1,
            },
          },
        },
      };

      const response = await messaging.sendMulticast(message);

      this.logger.log(
        `Notification sent to ${response.successCount}/${tokens.length} devices for user ${userId}`,
      );

      // Clean up invalid tokens
      if (response.failureCount > 0) {
        await this.cleanupInvalidTokens(userId, tokens, response.responses);
      }
    } catch (err) {
      this.logger.error(`Push notification failed for user ${userId}: ${(err as Error).message}`);
    }
  }

  /**
   * Clean up invalid FCM tokens from user's token array.
   * Called when sendMulticast returns failures for specific tokens.
   */
  private async cleanupInvalidTokens(
    userId: string,
    tokens: string[],
    responses: any[],
  ): Promise<void> {
    try {
      const invalidTokens: string[] = [];

      responses.forEach((response, index) => {
        if (!response.success) {
          const token = tokens[index];
          invalidTokens.push(token);
          this.logger.debug(`Invalid token detected: ${token.slice(0, 12)}...`);
        }
      });

      if (invalidTokens.length === 0) return;

      const user = await this.userModel.findById(userId);
      if (!user) return;

      // Remove invalid tokens
      user.fcmTokens = user.fcmTokens.filter(token => !invalidTokens.includes(token));
      await user.save();

      this.logger.log(`Cleaned up ${invalidTokens.length} invalid tokens for user ${userId}`);
    } catch (err) {
      this.logger.error(`Failed to cleanup invalid tokens: ${(err as Error).message}`);
    }
  }

  /**
   * Register or update FCM token for a user.
   * Adds token to user's fcmTokens array if not already present.
   */
  async registerToken(userId: string, token: string): Promise<void> {
    try {
      const user = await this.userModel.findById(userId);
      if (!user) {
        this.logger.warn(`User ${userId} not found for token registration`);
        return;
      }

      // Validate token format (basic validation)
      if (!token || token.length < 100) {
        this.logger.warn(`Invalid FCM token format for user ${userId}`);
        return;
      }

      // Add token if not already present
      if (!user.fcmTokens.includes(token)) {
        user.fcmTokens.push(token);
        await user.save();
        this.logger.log(`FCM token registered for user ${userId}`);
      } else {
        this.logger.debug(`FCM token already registered for user ${userId}`);
      }
    } catch (err) {
      this.logger.error(`Failed to register FCM token for user ${userId}: ${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * Remove FCM token for a user.
   * Called when user logs out or token becomes invalid.
   */
  async removeToken(userId: string, token: string): Promise<void> {
    try {
      const user = await this.userModel.findById(userId);
      if (!user) {
        this.logger.warn(`User ${userId} not found for token removal`);
        return;
      }

      const index = user.fcmTokens.indexOf(token);
      if (index > -1) {
        user.fcmTokens.splice(index, 1);
        await user.save();
        this.logger.log(`FCM token removed for user ${userId}`);
      }
    } catch (err) {
      this.logger.error(`Failed to remove FCM token for user ${userId}: ${(err as Error).message}`);
    }
  }

  /**
   * Remove all FCM tokens for a user.
   * Called when user logs out from all devices.
   */
  async removeAllTokens(userId: string): Promise<void> {
    try {
      const user = await this.userModel.findById(userId);
      if (!user) {
        this.logger.warn(`User ${userId} not found for token removal`);
        return;
      }

      user.fcmTokens = [];
      await user.save();
      this.logger.log(`All FCM tokens removed for user ${userId}`);
    } catch (err) {
      this.logger.error(`Failed to remove all FCM tokens for user ${userId}: ${(err as Error).message}`);
    }
  }

  // ── Order Status Notifications ──────────────────────────────────────────────

  async notifyOrderStatus(
    userId: string,
    orderNumber: string,
    status: string,
  ): Promise<void> {
    const messages: Record<string, { title: string; body: string; type: string }> = {
      ORDER_PLACED: {
        title: 'Order Confirmed! 🎉',
        body: `Order #${orderNumber} has been placed successfully.`,
        type: 'order_created',
      },
      PICKUP_ASSIGNED: {
        title: 'Pickup Assigned 🛵',
        body: `A rider is on the way to pick up your clothes for Order #${orderNumber}.`,
        type: 'pickup_assigned',
      },
      CLOTHES_RECEIVED: {
        title: 'Clothes Received ✅',
        body: `Your clothes for Order #${orderNumber} have been received.`,
        type: 'clothes_received',
      },
      WASHING_STARTED: {
        title: 'Washing Started 🧺',
        body: `Your clothes for Order #${orderNumber} are being washed.`,
        type: 'washing_started',
      },
      READY_FOR_DELIVERY: {
        title: 'Ready For Delivery 📦',
        body: `Your clothes for Order #${orderNumber} are ready for delivery.`,
        type: 'ready_for_delivery',
      },
      OUT_FOR_DELIVERY: {
        title: 'Out for Delivery 🚀',
        body: `Your fresh clothes are on the way! Share your OTP when the rider arrives for Order #${orderNumber}.`,
        type: 'out_for_delivery',
      },
      DELIVERED: {
        title: 'Delivered! 🎊',
        body: `Order #${orderNumber} has been delivered successfully. Thank you for choosing LaundryBrew!`,
        type: 'delivered',
      },
    };

    const msg = messages[status];
    if (msg) {
      await this.sendToUser(userId, {
        ...msg,
        orderId: orderNumber,
      });
    }
  }

  async notifyPaymentSuccess(userId: string, orderNumber: string): Promise<void> {
    await this.sendToUser(userId, {
      title: 'Payment Successful 💳',
      body: `Payment confirmed for Order #${orderNumber}. Your delivery OTP is ready in the app.`,
      type: 'payment_success',
      orderId: orderNumber,
    });
  }
}
