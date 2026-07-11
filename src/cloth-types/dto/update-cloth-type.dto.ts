import { IsArray, IsNumber, IsOptional, IsString, IsBoolean, IsIn, Min } from 'class-validator';
import { CLOTH_TYPE_CATEGORIES, CLOTH_TYPE_SUBCATEGORIES } from './create-cloth-type.dto';

export class UpdateClothTypeDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  instantRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  scheduledRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountInstantRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountScheduledRate?: number;

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
