import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { RewardType } from '../enums/referral.enums';

/** POST /admin/referral/settings — partial update of the settings singleton. */
export class UpdateReferralSettingsDto {
  @IsOptional() @IsBoolean() referralEnabled?: boolean;

  @IsOptional() @IsEnum(RewardType) rewardType?: RewardType;

  @IsOptional() @IsNumber() @Min(0) referrerRewardAmount?: number;
  @IsOptional() @IsNumber() @Min(0) refereeRewardAmount?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) rewardPercentage?: number;

  @IsOptional() @IsNumber() @Min(0) minimumOrderValue?: number;
  @IsOptional() @IsNumber() @Min(0) maximumReferralReward?: number;

  @IsOptional() @IsInt() @Min(1) referralExpiryDays?: number;
  @IsOptional() @IsInt() @Min(0) dailyLimit?: number;
  @IsOptional() @IsInt() @Min(0) monthlyLimit?: number;
  @IsOptional() @IsInt() @Min(0) lifetimeLimit?: number;

  @IsOptional() @IsBoolean() blockSameDevice?: boolean;
  @IsOptional() @IsBoolean() blockSameIp?: boolean;
  @IsOptional() @IsBoolean() vpnDetectionEnabled?: boolean;

  @IsOptional() @IsBoolean() pushNotificationsEnabled?: boolean;
  @IsOptional() @IsBoolean() emailNotificationsEnabled?: boolean;
}

/** Body for release / reject / reverse admin actions. */
export class ReferralActionDto {
  @IsMongoId()
  referralId: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

/** GET /admin/referral/report + /admin/referral (list) query params. */
export class ReferralReportQueryDto {
  @IsOptional() @IsString() from?: string; // ISO date
  @IsOptional() @IsString() to?: string; // ISO date

  @IsOptional()
  @IsString()
  granularity?: 'daily' | 'weekly' | 'monthly';

  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() search?: string;

  /** Export format for GET /admin/referral/export. */
  @IsOptional() @IsString() format?: 'csv' | 'excel';

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 20;
}
