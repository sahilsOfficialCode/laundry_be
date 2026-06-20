import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;
export enum UserRole {
  ADMIN = 'admin',
  USER = 'user',
}

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true })
  name: string;

  @Prop({
  type: String,
  required: false,
  unique: true,
  sparse: true,
  default: null,
  trim: true,
})
email?: string;

  @Prop({ required: false })
  password?: string;

  @Prop({ required: false, unique: true, sparse: true, trim: true })
  mobileNumber?: string;

  @Prop({ enum: UserRole, default: UserRole.USER, required: true })
  role: UserRole;

  @Prop()
  passwordResetToken?: string;

  @Prop()
  passwordResetExpiresAt?: Date;

  @Prop({ default: true })
  isActive: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);
