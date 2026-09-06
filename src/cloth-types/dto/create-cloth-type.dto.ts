import { IsArray, IsNumber, IsOptional, IsString, IsBoolean, IsIn, IsEnum, Min } from 'class-validator';
import { PricingUnit } from '../../pricing/pricing-unit.enum';

export const CLOTH_TYPE_CATEGORIES = [
  'ironing',
  'shoeCleaning',
  'dryCleaning',
  'washFold',
  'washIron',
  'membership',
] as const;
export const CLOTH_TYPE_SUBCATEGORIES = [
  'unisex',
  'men',
  'women',
  'kids',
  'household',
  'delicate',
  'package',
  'plan',
  'ironPass',
  'smartPass',
  'combo',
] as const;

export class CreateClothTypeDto {
  @IsString()
  name: string;

  @IsNumber()
  @Min(0)
  instantRate: number;

  @IsNumber()
  @Min(0)
  scheduledRate: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountInstantRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountScheduledRate?: number;

  @IsOptional()
  @IsEnum(PricingUnit)
  unit?: PricingUnit;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(CLOTH_TYPE_CATEGORIES)
  category?: string;

  @IsOptional()
  @IsIn(CLOTH_TYPE_SUBCATEGORIES)
  subcategory?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  includes?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludedItems?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  validityDays?: number;
}
