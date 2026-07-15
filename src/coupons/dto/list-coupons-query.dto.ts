import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { CouponEffectiveStatus } from '../enums/coupon.enums';

export class ListCouponsQueryDto {
  /** Free-text search across coupon code / name. */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn([CouponEffectiveStatus.ACTIVE, CouponEffectiveStatus.EXPIRED, CouponEffectiveStatus.DISABLED])
  status?: CouponEffectiveStatus;

  /** Filter by expiry date range (inclusive), ISO strings. */
  @IsOptional()
  @IsString()
  expiryFrom?: string;

  @IsOptional()
  @IsString()
  expiryTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsIn(['couponCode', 'couponName', 'expiryDate', 'createdAt', 'assignedUsersCount', 'usedUsersCount'])
  sortBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
