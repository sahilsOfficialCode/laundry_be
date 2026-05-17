import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { UserRole } from '../../users/schemas/user.schema';

export type MessageDocument = Message & Document;

@Schema({ timestamps: true })
export class Message {
  @Prop({ required: true, index: true })
  conversationId: string;

  @Prop({ required: true })
  senderId: string;

  @Prop({ type: String, enum: UserRole, required: true })
  senderRole: UserRole;

  @Prop({ required: true, trim: true, maxlength: 2000 })
  body: string;

  @Prop()
  readAt?: Date;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

MessageSchema.index({ conversationId: 1, createdAt: -1 });
