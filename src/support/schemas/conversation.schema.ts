import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ConversationDocument = Conversation & Document;

export enum ConversationStatus {
  OPEN = 'open',
  RESOLVED = 'resolved',
}

@Schema({ timestamps: true })
export class Conversation {
  @Prop({ required: true })
  userId: string;

  @Prop({
    type: String,
    enum: ConversationStatus,
    default: ConversationStatus.OPEN,
  })
  status: ConversationStatus;

  @Prop()
  lastMessagePreview?: string;

  @Prop()
  lastMessageAt?: Date;

  @Prop({ default: 0, min: 0 })
  unreadForUser: number;

  @Prop({ default: 0, min: 0 })
  unreadForAdmin: number;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);

ConversationSchema.index({ userId: 1 }, { unique: true });
ConversationSchema.index({ lastMessageAt: -1 });
