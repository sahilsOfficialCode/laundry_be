import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class VerifyMobileOtpDto {
  @IsString()
  @MinLength(10)
  @MaxLength(15)
  @Matches(/^\+?[0-9]{10,15}$/, {
    message:
      'mobileNumber must contain only digits and can optionally start with +',
  })
  mobileNumber: string;

  @IsString()
  @Matches(/^[0-9]{6}$/, { message: 'otp must be a 6 digit number' })
  otp: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;
}
