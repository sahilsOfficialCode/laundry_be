import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AccountDeletionService } from './services/account-deletion.service';
import { AuthService } from '../auth/auth.service';
import { GetUser } from '../auth/decorators/get-user.decorator';
import {
  ConfirmDeleteDto,
  RequestDeleteDto,
  SendDeleteOtpDto,
  VerifyDeleteDto,
} from './dto/account-deletion.dto';
import { RateLimit, RateLimitGuard } from './guards/rate-limit.guard';
import { InjectModel } from '@nestjs/mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Model } from 'mongoose';

/**
 * User-facing account-deletion endpoints (Google Play compliant, in-app flow).
 * All routes require a valid JWT (global JwtAuthGuard). Sensitive routes are
 * additionally rate-limited.
 */
@Controller('account/delete')
@UseGuards(RateLimitGuard)
export class AccountDeletionController {
  constructor(
    private readonly deletionService: AccountDeletionService,
    private readonly authService: AuthService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  /** POST /account/delete/request */
  @Post('request')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 5, windowMs: 60 * 60 * 1000 })
  request(
    @GetUser() user: any,
    @Body() dto: RequestDeleteDto,
    @Req() req: Request,
  ) {
    return this.deletionService.requestDelete(user.sub, dto, {
      ipAddress: this.ip(req),
    });
  }

  /**
   * POST /account/delete/send-otp — send an OTP to the user's mobile for the
   * OTP verification method. Reuses the existing OTP infrastructure.
   */
  @Post('send-otp')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 5, windowMs: 15 * 60 * 1000 })
  async sendOtp(@GetUser() user: any, @Body() _dto: SendDeleteOtpDto) {
    const u = await this.userModel
      .findById(user.sub)
      .select('mobileNumber')
      .lean();
    if (!u?.mobileNumber) {
      return { success: false, message: 'No mobile number on file' };
    }
    // Reuse AuthService.sendMobileOtp via the shared OTP store.
    await this.authService.sendMobileOtp({ mobileNumber: u.mobileNumber });
    return { success: true, message: 'OTP sent' };
  }

  /** POST /account/delete/verify */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, windowMs: 15 * 60 * 1000 })
  verify(
    @GetUser() user: any,
    @Body() dto: VerifyDeleteDto,
    @Req() req: Request,
  ) {
    return this.deletionService.verifyIdentity(user.sub, dto, {
      ipAddress: this.ip(req),
    });
  }

  /** POST /account/delete/confirm — final, irreversible confirmation. */
  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 5, windowMs: 60 * 60 * 1000 })
  confirm(
    @GetUser() user: any,
    @Body() dto: ConfirmDeleteDto,
    @Req() req: Request,
  ) {
    const token =
      req.cookies?.access_token ??
      req.headers.authorization?.split(' ')[1];
    return this.deletionService.confirmDelete(user.sub, dto, {
      ipAddress: this.ip(req),
      token,
      tokenExp: user.exp ? user.exp * 1000 : undefined,
    });
  }

  /** GET /account/delete/status */
  @Get('status')
  status(@GetUser() user: any) {
    return this.deletionService.getStatus(user.sub);
  }

  private ip(req: Request): string | undefined {
    const fwd = (req.headers['x-forwarded-for'] as string) || '';
    return fwd.split(',')[0].trim() || req.ip || undefined;
  }
}
