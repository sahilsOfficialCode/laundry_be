import { ArrayMaxSize, IsArray, IsEnum, IsMongoId, IsOptional, IsString } from 'class-validator';
import { CouponBulkCondition } from '../enums/coupon.enums';

/**
 * Bulk assignment by condition — the admin picks one of the pre-built
 * segments (see coupon-conditions.service.ts) and the backend resolves it
 * to a set of matching userIds, then assigns them all in one pass.
 */
export class BulkAssignDto {
  @IsEnum(CouponBulkCondition)
  condition: CouponBulkCondition;

  /** Required when condition === CITY. */
  @IsOptional()
  @IsString()
  city?: string;

  /** Required when condition === CUSTOM_USER_IDS. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20000)
  @IsMongoId({ each: true })
  userIds?: string[];
}
