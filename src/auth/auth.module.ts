import { Module, forwardRef } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SendMobileOtpService } from './services/send-mobile-otp.service';
import { TokenBlacklistService } from './token-blacklist.service';
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
          signOptions: { expiresIn: '1h' },
        };
      },
    }),
  ],
  providers: [
    AuthService,
    SendMobileOtpService,
    TokenBlacklistService,
    {
      provide: SMS_PROVIDER,
      useClass: ConsoleSmsProvider,
    },
  ],
  controllers: [AuthController],
  exports: [AuthService, TokenBlacklistService]
})
export class AuthModule {}
