import { IsString, IsNotEmpty, MinLength, MaxLength, Matches } from 'class-validator';

export class RegisterFcmTokenDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(100, { message: 'FCM token must be at least 100 characters' })
  @MaxLength(500, { message: 'FCM token must not exceed 500 characters' })
  @Matches(/^[a-zA-Z0-9:_-]+$/, { message: 'FCM token contains invalid characters' })
  fcmToken: string;
}
