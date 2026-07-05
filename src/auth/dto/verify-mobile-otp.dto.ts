import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { IsMobileNumber } from '../../common/validators/is-mobile-number.validator';

export class VerifyMobileOtpDto {
  @IsMobileNumber()
  mobileNumber: string;

  @IsString()
  @Matches(/^[0-9]{6}$/, { message: 'otp must be a 6 digit number' })
  otp: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;
}
