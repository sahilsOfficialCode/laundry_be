import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ReferralService } from './services/referral.service';
import { ReferralSettingsService } from './services/referral-settings.service';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { ApplyReferralDto, ValidateReferralDto } from './dto/apply-referral.dto';
import { HistoryQueryDto } from './dto/history-query.dto';

/**
 * User-facing referral endpoints. All routes are protected by the global
 * JwtAuthGuard; `user.sub` is the authenticated user's id.
 */
@Controller('referral')
export class ReferralController {
  constructor(
    private readonly referralService: ReferralService,
    private readonly settingsService: ReferralSettingsService,
  ) {}

  /** POST /referral/validate — check a code before applying it. */
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  validate(@GetUser() user: any, @Body() dto: ValidateReferralDto) {
    return this.referralService.validateCode(dto.code, user.sub);
  }

  /** POST /referral/apply — apply a referral code during onboarding. */
  @Post('apply')
  @HttpCode(HttpStatus.OK)
  apply(
    @GetUser() user: any,
    @Body() dto: ApplyReferralDto,
    @Req() req: Request,
  ) {
    return this.referralService.applyReferral(user.sub, dto, {
      ipAddress: this.clientIp(req),
    });
  }

  /** GET /referral/my — the user's code, share link and headline stats. */
  @Get('my')
  getMy(@GetUser() user: any) {
    return this.referralService.getMyReferral(user.sub);
  }

  /** GET /referral/history — paginated referral history. */
  @Get('history')
  history(@GetUser() user: any, @Query() query: HistoryQueryDto) {
    return this.referralService.getHistory(user.sub, query.page, query.limit);
  }

  /** GET /referral/dashboard — combined "Refer & Earn" home payload. */
  @Get('dashboard')
  async dashboard(@GetUser() user: any) {
    const [my, history, settings] = await Promise.all([
      this.referralService.getMyReferral(user.sub),
      this.referralService.getHistory(user.sub, 1, 5),
      this.settingsService.get(),
    ]);
    return {
      ...my,
      recent: history.data,
      program: {
        enabled: settings.referralEnabled,
        rewardType: settings.rewardType,
        referrerReward: settings.referrerRewardAmount,
        refereeReward: settings.refereeRewardAmount,
        minimumOrderValue: settings.minimumOrderValue,
      },
    };
  }

  /** GET /referral/settings — public-facing subset of the programme rules. */
  @Get('settings')
  async settings() {
    const s = await this.settingsService.get();
    return {
      enabled: s.referralEnabled,
      rewardType: s.rewardType,
      referrerReward: s.referrerRewardAmount,
      refereeReward: s.refereeRewardAmount,
      minimumOrderValue: s.minimumOrderValue,
      maximumReferralReward: s.maximumReferralReward,
      expiryDays: s.referralExpiryDays,
    };
  }

  /** Best-effort client IP (respects X-Forwarded-For behind a proxy). */
  private clientIp(req: Request): string | undefined {
    const fwd = (req.headers['x-forwarded-for'] as string) || '';
    return fwd.split(',')[0].trim() || req.ip || undefined;
  }
}
