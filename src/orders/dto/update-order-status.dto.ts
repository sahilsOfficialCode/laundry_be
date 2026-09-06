import {

  IsEnum,

  IsOptional,

  IsString,

  IsNumber,

  Min,

  MaxLength,

  ValidateNested,

} from 'class-validator';

import { Type } from 'class-transformer';

import { OrderStatus } from '../schemas/order.schema';

import { ClothTypeBreakdownDto } from './cloth-type-breakdown.dto';



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
   * Cloth-type breakdown — set when status = ITEMIZED
   * Frontend sends only clothTypeId and quantity
   * Backend derives clothTypeName, rate, and amount
   */

  @IsOptional()

  @ValidateNested({ each: true })

  @Type(() => ClothTypeBreakdownDto)

  clothTypeBreakdown?: ClothTypeBreakdownDto[];



  /**
   * Reason for a manual admin price override — MANDATORY whenever billAmount
   * is submitted and differs from the engine-calculated amount. Recorded in
   * the PriceAdjustmentLog audit trail alongside the admin's id/ip/timestamp.
   */

  @IsOptional()

  @IsString()

  @MaxLength(500)

  overrideReason?: string;



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



  /** Optional reason recorded when an admin cancels an order — status = CANCELLED. */

  @IsOptional()

  @IsString()

  @MaxLength(500)

  cancellationReason?: string;

}

