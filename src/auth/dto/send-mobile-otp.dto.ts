import { IsOptional, IsString, MaxLength } from 'class-validator';
import { IsMobileNumber } from '../../common/validators/is-mobile-number.validator';

export class SendMobileOtpDto {
  @IsMobileNumber()
  mobileNumber: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;
}
