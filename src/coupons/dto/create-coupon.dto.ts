import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CouponDiscountType, CouponStatus } from '../enums/coupon.enums';

export class CreateCouponDto {
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'Coupon code may only contain letters, numbers, hyphens and underscores',
  })
  couponCode: string;

  @IsString()
  @MinLength(2)
  @MaxLength(150)
  couponName: string;

  @IsEnum(CouponDiscountType)
  discountType: CouponDiscountType;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  discountValue: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minimumOrderAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maximumDiscount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  usagePerUser?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  totalUsageLimit?: number;

  @IsDateString()
  startDate: string;

  @IsDateString()
  expiryDate: string;

  @IsOptional()
  @IsEnum(CouponStatus)
  status?: CouponStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
