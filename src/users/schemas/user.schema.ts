import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;
export enum UserRole {
  ADMIN            = 'admin',
  USER             = 'user',
  DELIVERY_PARTNER = 'delivery_partner',
}

export class UserAddress {
  id: string;
  houseNo?: string;
  buildingName?: string;
  street?: string;
  area?: string;
  landmark?: string;
  city?: string;
  state?: string;
  pincode?: string;
  type?: string;
  instructions?: string;
  isDefault: boolean;
  lat?: number;
  lng?: number;
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
  trim: true,
})
email?: string;

  @Prop({ required: false })
  password?: string;

  @Prop({ required: false, unique: true, sparse: true, trim: true })
  mobileNumber?: string;

  @Prop({ enum: UserRole, default: UserRole.USER, required: true })
  role: UserRole;

  /**
   * Permanent, unique, auto-generated referral code (Refer & Earn).
   * Assigned at registration; never editable by the user.
   */
  @Prop({ required: false, unique: true, sparse: true, index: true })
  referralCode?: string;

  @Prop()
  passwordResetToken?: string;

  @Prop()
  passwordResetExpiresAt?: Date;

  @Prop({ default: true })
  isActive: boolean;

  // ── Account deletion (Google Play compliant soft-delete) ───────────────────
  /** Soft-delete flag. Deleted users are rejected by JwtAuthGuard everywhere. */
  @Prop({ default: false, index: true })
  isDeleted: boolean;

  /** ACTIVE | PENDING_DELETION | DELETED | ANONYMIZED */
  @Prop({ default: 'ACTIVE', index: true })
  accountStatus: string;

  @Prop({ required: false, default: null })
  deletedAt?: Date;

  @Prop({ required: false, default: null })
  deletedReason?: string;

  @Prop({ required: false, default: null })
  deletedReasonComment?: string;

  /** Personal data has been stripped/anonymised by the cleanup job. */
  @Prop({ required: false, default: null })
  anonymizedAt?: Date;

  /**
   * Any JWT issued before this instant is treated as invalid ("logout from
   * every device"). Set to now() on account deletion. Compared against the
   * token's `iat` claim in JwtAuthGuard.
   */
  @Prop({ required: false, default: null })
  sessionsValidFrom?: Date;

  /** FCM device tokens for push notifications. Supports multiple devices per user. */
  @Prop({ required: false, default: [] })
  fcmTokens: string[];

  /** Profile photo URL (Cloudflare R2). Set when user uploads a photo. */
  @Prop({ required: false, default: null })
  photoUrl?: string;

  /** Wallet balance in INR. Credits/debits managed by WalletService. */
  @Prop({ required: false, default: 0, min: 0 })
  walletBalance: number;

  @Prop({
    type: [
      {
        id: { type: String, required: true },
        houseNo: { type: String, default: '' },
        buildingName: { type: String, default: '' },
        street: { type: String, default: '' },
        area: { type: String, default: '' },
        landmark: { type: String, default: '' },
        city: { type: String, default: '' },
        state: { type: String, default: '' },
        pincode: { type: String, default: '' },
        type: { type: String, default: 'Home' },
        instructions: { type: String, default: '' },
        isDefault: { type: Boolean, default: false },
        lat: { type: Number, required: false },
        lng: { type: Number, required: false },
      },
    ],
    default: [],
  })
  addresses: UserAddress[];
}

export const UserSchema = SchemaFactory.createForClass(User);
