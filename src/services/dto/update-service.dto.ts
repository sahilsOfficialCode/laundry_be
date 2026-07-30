import {
  IsString,
  IsNumber,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsArray,
  IsIn,
  IsInt,
  IsEnum,
  Min,
  Max,
} from 'class-validator';
import { PricingUnit } from '../../pricing/pricing-unit.enum';

export class UpdateServiceDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsEnum(PricingUnit)
  unit?: PricingUnit;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  instantDescription?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  scheduledDescription?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  instantOrderPlacedMessage?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  scheduledOrderPlacedMessage?: string;

  @IsOptional()
  @IsArray()
  @IsIn(['instant', 'scheduled'], { each: true })
  categories?: string[];

  @IsOptional()
  @IsString()
  instantDuration?: string;

  @IsOptional()
  @IsString()
  scheduledDuration?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  turnaroundHours?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  instantTurnaroundMinutes?: number;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @IsOptional()
  @IsBoolean()
  isPopular?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  popularOrder?: number;
}
