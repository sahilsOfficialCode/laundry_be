import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  IsNumber,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { DeliveryType } from '../schemas/order.schema';
import { DeliveryAddressDto } from './delivery-address.dto';

export class CheckoutContextDto {
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  pickupLatitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  pickupLongitude?: number;

  @IsOptional()
  @IsDateString()
  pickupDate?: string;

  @IsOptional()
  @ValidateIf((o) => o.pickupTime !== undefined && o.pickupTime !== null && o.pickupTime !== '')
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  pickupTime?: string;

  @IsOptional()
  @IsString()
  pickupSlot?: string;

  @IsOptional()
  @IsString()
  deliverySlot?: string;

  @IsOptional()
  @IsString()
  city?: string;

  /** How the finished order should get back to the customer. Defaults to HOME_DELIVERY. */
  @IsOptional()
  @IsEnum(DeliveryType)
  deliveryType?: DeliveryType;

  /** Required when deliveryType is HOME_DELIVERY — freshly chosen from saved addresses. */
  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveryAddressDto)
  deliveryAddress?: DeliveryAddressDto;
}
