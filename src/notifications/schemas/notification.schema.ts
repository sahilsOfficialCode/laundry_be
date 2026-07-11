import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AppNotificationDocument = AppNotification & Document;

/**
 * Persisted in-app notification, shown in the notification bar of the
 * user app (audience: 'user') and the admin panel (audience: 'admin').
 */
@Schema({ timestamps: true })
export class AppNotification {
  /** 'user' → for a specific customer; 'admin' → for the admin panel */
  @Prop({ required: true, index: true })
  audience!: string;

  /** Set when audience === 'user' */
  @Prop({ required: false, index: true })
  userId?: string;

  @Prop({ required: true })
  title!: string;

  @Prop({ required: true })
  body!: string;

  @Prop({ default: 'general' })
  type?: string;

  @Prop({ required: false })
  orderId?: string;

  @Prop({ default: false, index: true })
  isRead!: boolean;
}

export const AppNotificationSchema =
  SchemaFactory.createForClass(AppNotification);

// Keep the collection lean — auto-expire notifications after 30 days.
AppNotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
