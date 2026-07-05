import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SendMobileOtpDto } from './dto/send-mobile-otp.dto';
import { VerifyMobileOtpDto } from './dto/verify-mobile-otp.dto';
import { FirebaseLoginDto } from './dto/firebase-login.dto';
import { GetUser } from './decorators/get-user.decorator';
import { Public } from './decorators/public.decorator';
import { TokenBlacklistService } from './token-blacklist.service';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private tokenBlacklistService: TokenBlacklistService,
  ) {}

  /** Shared secure cookie attributes (kept in one place to avoid drift). */
  private static readonly COOKIE_BASE = {
    httpOnly: true, // not readable by JS — mitigates XSS token theft
    secure: true, // HTTPS only
    sameSite: 'none' as const, // needed for cross-origin frontend
    path: '/',
  };

  /** Set the auth cookie with a maxAge that matches the JWT's own lifetime. */
  private setAuthCookie(response: Response, result: { access_token: string; maxAge: number }) {
    response.cookie('access_token', result.access_token, {
      ...AuthController.COOKIE_BASE,
      maxAge: result.maxAge,
    });
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body() signInDto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(signInDto);

    // Cookie lifetime mirrors the JWT lifetime (admin 24h, others ~3 months).
    this.setAuthCookie(response, result);

    return result;
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('mobile/send-otp')
  async sendMobileOtp(@Body() sendMobileOtpDto: SendMobileOtpDto) {
    return this.authService.sendMobileOtp(sendMobileOtpDto);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('mobile/verify-otp')
  async verifyMobileOtp(
    @Body() verifyMobileOtpDto: VerifyMobileOtpDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.verifyMobileOtp(verifyMobileOtpDto);
    if ('access_token' in result) {
      this.setAuthCookie(response, result);
    }

    return result;
  }

  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    // Extract the token from cookie or Authorization header and blacklist it
    const token =
      request.cookies?.access_token ??
      request.headers.authorization?.split(' ')[1];

    if (token) {
      // Decode exp without full verification (token may already be expired)
      try {
        const [, payloadB64] = token.split('.');
        const payload = JSON.parse(
          Buffer.from(payloadB64, 'base64url').toString('utf8'),
        );
        const expiresAt = payload.exp ? payload.exp * 1000 : undefined;
        this.tokenBlacklistService.revoke(token, expiresAt);
      } catch {
        // If decoding fails, revoke with default TTL
        this.tokenBlacklistService.revoke(token);
      }
    }

    response.clearCookie('access_token', AuthController.COOKIE_BASE);
    return { message: 'Logged out successfully' };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('firebase-login')
  async firebaseLogin(
    @Body() firebaseLoginDto: FirebaseLoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.firebaseLogin(firebaseLoginDto);
    if ('access_token' in result) {
      this.setAuthCookie(response, result);
    }

    return result;
  }

  @HttpCode(HttpStatus.OK)
  @Get('me')
  async me(@GetUser() user: any) {
    return user;
  }
}
