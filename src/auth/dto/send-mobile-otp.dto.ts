import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class SendMobileOtpDto {
  @IsString()
  @MinLength(10)
  @MaxLength(16)
  @Matches(/^\+?[0-9]{10,15}$/, {
    message:
      'mobileNumber must contain only digits and can optionally start with +',
  })
  mobileNumber: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;
}
