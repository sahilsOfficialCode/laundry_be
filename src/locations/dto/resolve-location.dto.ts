import { Type } from 'class-transformer';
import {
  IsDateString,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  IsNumber,
  IsBoolean,
} from 'class-validator';

export class ResolveLocationDto {
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsDateString()
  requestedDate?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  requestedTime?: string;

  @IsOptional()
  @IsString()
  pickupSlot?: string;

  @IsOptional()
  @IsString()
  deliverySlot?: string;

  @IsOptional()
  @IsString()
  preferredLocationId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  searchRadiusKm?: number;
}

export class EligibleLocationCheckDto extends ResolveLocationDto {
  @IsOptional()
  @IsBoolean()
  enforceCapacity?: boolean;
}
