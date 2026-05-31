import { Type } from 'class-transformer';
import {
  IsDateString,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  IsNumber,
} from 'class-validator';

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
}
