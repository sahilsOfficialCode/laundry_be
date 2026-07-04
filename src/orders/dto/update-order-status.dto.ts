import {
  IsEnum,
  IsOptional,
  IsString,
  IsNumber,
  Min,
} from 'class-validator';
import { OrderStatus } from '../schemas/order.schema';

export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus)
  status: OrderStatus;

  /** Driver name — required when status = PICKUP_ASSIGNED */
  @IsOptional()
  @IsString()
  driverName?: string;

  /** Driver phone — required when status = PICKUP_ASSIGNED */
  @IsOptional()
  @IsString()
  driverPhone?: string;

  /** Weight in kg — set when status = ITEMIZED */
  @IsOptional()
  @IsNumber()
  @Min(0)
  weightKg?: number;

  /** Item count — set when status = ITEMIZED */
  @IsOptional()
  @IsNumber()
  @Min(0)
  itemCount?: number;

  /**
   * Bill amount after itemization — MANDATORY when advancing to ITEMIZED.
   * This is the confirmed price the user will be charged.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  billAmount?: number;

  /**
   * Confirmed pickup time label — MANDATORY when advancing to ITEMIZED.
   * e.g. "10:00 AM – 12:00 PM"
   */
  @IsOptional()
  @IsString()
  pickupTime?: string;

  /** Delivery partner userId — set when status = OUT_FOR_DELIVERY */
  @IsOptional()
  @IsString()
  deliveryPartnerId?: string;

  /** Delivery partner display name — set when status = OUT_FOR_DELIVERY */
  @IsOptional()
  @IsString()
  deliveryPartnerName?: string;

  /** ETA in minutes — set when status = OUT_FOR_DELIVERY */
  @IsOptional()
  @IsNumber()
  @Min(0)
  etaMinutes?: number;

  /** Driver distance from customer in km — set when status = OUT_FOR_DELIVERY */
  @IsOptional()
  @IsNumber()
  @Min(0)
  driverDistanceKm?: number;

  /**
   * 4-digit OTP — MANDATORY when admin confirms delivery (OUT_FOR_DELIVERY → COMPLETED).
   * Must match the OTP that was generated after the user's payment.
   */
  @IsOptional()
  @IsString()
  otp?: string;
}
