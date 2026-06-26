import {
  IsEnum,
  IsOptional,
  IsString,
  IsNumber,
  Min,
  Matches,
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

  /** Bill amount after itemization */
  @IsOptional()
  @IsNumber()
  @Min(0)
  billAmount?: number;

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
}
