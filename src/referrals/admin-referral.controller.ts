import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserRole } from '../users/schemas/user.schema';
import { ReferralService } from './services/referral.service';
import { ReferralSettingsService } from './services/referral-settings.service';
import { ReferralAnalyticsService } from './services/referral-analytics.service';
import {
  ReferralActionDto,
  ReferralReportQueryDto,
  UpdateReferralSettingsDto,
} from './dto/admin-referral.dto';

/**
 * Admin referral management. Every route requires the ADMIN role.
 * (JwtAuthGuard is already global; RolesGuard enforces the role.)
 */
@Controller('admin/referral')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminReferralController {
  constructor(
    private readonly referralService: ReferralService,
    private readonly settingsService: ReferralSettingsService,
    private readonly analyticsService: ReferralAnalyticsService,
  ) {}

  // ── Dashboard + reporting ──────────────────────────────────────────────────

  /** GET /admin/referral/dashboard — summary cards. */
  @Get('dashboard')
  dashboard() {
    return this.analyticsService.dashboard();
  }

  /** GET /admin/referral — searchable, paginated referral list. */
  @Get()
  list(@Query() query: ReferralReportQueryDto) {
    return this.analyticsService.listReferrals(query);
  }

  /** GET /admin/referral/report — time-series analytics. */
  @Get('report')
  report(@Query() query: ReferralReportQueryDto) {
    return this.analyticsService.report(query);
  }

  /** GET /admin/referral/timeline/:id — full audit timeline for a referral. */
  @Get('timeline/:id')
  timeline(@Param('id') id: string) {
    return this.referralService.getTimeline(id);
  }

  /** GET /admin/referral/export?format=csv|excel — export current list. */
  @Get('export')
  async export(
    @Query() query: ReferralReportQueryDto,
    @Res() res: Response,
  ) {
    const { data } = await this.analyticsService.listReferrals({
      ...query,
      limit: 10_000,
      page: 1,
    });

    const headers = [
      'referralId',
      'referrerId',
      'refereeId',
      'code',
      'status',
      'firstOrderValue',
      'registeredAt',
      'rewardReleasedAt',
      'rejectedReason',
    ];
    const rows = data.map((r: any) =>
      headers
        .map((h) => this.csvCell(r[h === 'referralId' ? '_id' : h]))
        .join(','),
    );
    const csv = [headers.join(','), ...rows].join('\n');

    const isExcel = (query as any).format === 'excel';
    res.setHeader(
      'Content-Type',
      isExcel ? 'application/vnd.ms-excel' : 'text/csv',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="referrals.${isExcel ? 'xls' : 'csv'}"`,
    );
    res.send(csv);
  }

  // ── Settings ───────────────────────────────────────────────────────────────

  /** GET /admin/referral/settings — full settings for the admin form. */
  @Get('settings')
  getSettings() {
    return this.settingsService.get();
  }

  /** POST /admin/referral/settings — update programme configuration. */
  @Post('settings')
  @HttpCode(HttpStatus.OK)
  updateSettings(@Body() dto: UpdateReferralSettingsDto) {
    return this.settingsService.update(dto);
  }

  // ── Reward actions ─────────────────────────────────────────────────────────

  /** POST /admin/referral/release — manually release a reward. */
  @Post('release')
  @HttpCode(HttpStatus.OK)
  release(@GetUser() admin: any, @Body() dto: ReferralActionDto) {
    return this.referralService.adminRelease(dto.referralId, admin.sub);
  }

  /** POST /admin/referral/reject — reject a referral. */
  @Post('reject')
  @HttpCode(HttpStatus.OK)
  reject(@GetUser() admin: any, @Body() dto: ReferralActionDto) {
    return this.referralService.adminReject(
      dto.referralId,
      dto.reason ?? '',
      admin.sub,
    );
  }

  /** POST /admin/referral/reverse — claw back a released reward. */
  @Post('reverse')
  @HttpCode(HttpStatus.OK)
  reverse(@GetUser() admin: any, @Body() dto: ReferralActionDto) {
    return this.referralService.adminReverse(
      dto.referralId,
      dto.reason ?? '',
      admin.sub,
    );
  }

  /** POST /admin/referral/hold — park a referral for review. */
  @Post('hold')
  @HttpCode(HttpStatus.OK)
  hold(@GetUser() admin: any, @Body() dto: ReferralActionDto) {
    return this.referralService.adminHold(dto.referralId, admin.sub);
  }

  private csvCell(value: any): string {
    if (value === null || value === undefined) return '';
    const s = String(value).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  }
}
