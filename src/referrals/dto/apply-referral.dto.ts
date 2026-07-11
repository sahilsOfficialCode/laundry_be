import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

/** POST /referral/validate — check a code is usable before registering. */
export class ValidateReferralDto {
  @IsString()
  @Length(4, 16)
  code: string;
}

/**
 * POST /referral/apply — bind a referral code to the current (new) user.
 * The anti-abuse context is optional but strongly recommended from the client.
 */
export class ApplyReferralDto {
  @IsString()
  @Length(4, 16)
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string;

  @IsOptional()
  @IsBoolean()
  isEmulator?: boolean;

  @IsOptional()
  @IsBoolean()
  isFakeGps?: boolean;

  @IsOptional()
  @IsBoolean()
  isVpn?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}
