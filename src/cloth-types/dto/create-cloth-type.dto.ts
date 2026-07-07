import { IsNumber, IsOptional, IsString, IsBoolean, IsIn, Min } from 'class-validator';

export const CLOTH_TYPE_CATEGORIES = ['ironing', 'shoeCleaning', 'dryCleaning'] as const;
export const CLOTH_TYPE_SUBCATEGORIES = [
  'unisex',
  'men',
  'women',
  'kids',
  'household',
  'delicate',
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
}
