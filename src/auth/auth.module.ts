import { Module, forwardRef } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SendMobileOtpService } from './services/send-mobile-otp.service';
import { TokenBlacklistService } from './token-blacklist.service';
import { FirebaseAdminService } from './services/firebase-admin.service';
import { SMS_PROVIDER } from './sms/sms-provider.token';
import { ConsoleSmsProvider } from './sms/console-sms.provider';

@Module({
  imports: [
    forwardRef(() => UsersModule),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const jwtSecret = configService.get<string>('JWT_SECRET');

        if (!jwtSecret || jwtSecret.length < 32) {
          throw new Error(
            'JWT_SECRET must be set and at least 32 characters long',
          );
        }

        return {
          secret: jwtSecret,
          // No global expiresIn: token lifetime is set per role at sign time
          // in AuthService.buildAuthResponse (admin 24h, user/delivery ~3 months).
        };
      },
    }),
  ],
  providers: [
    AuthService,
    SendMobileOtpService,
    TokenBlacklistService,
    FirebaseAdminService,
    {
      provide: SMS_PROVIDER,
      useClass: ConsoleSmsProvider,
    },
  ],
  controllers: [AuthController],
  exports: [AuthService, TokenBlacklistService, FirebaseAdminService]
})
export class AuthModule {}
