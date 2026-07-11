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
import { AccountDeletionAdminService } from './services/account-deletion-admin.service';
import {
  AdminDeleteActionDto,
  DeleteHistoryQueryDto,
} from './dto/account-deletion.dto';

/**
 * Admin management of account-deletion requests. Requires the ADMIN role.
 */
@Controller('admin/delete')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminAccountDeletionController {
  constructor(private readonly adminService: AccountDeletionAdminService) {}

  /** GET /admin/delete/dashboard */
  @Get('dashboard')
  dashboard() {
    return this.adminService.dashboard();
  }

  /** GET /admin/delete/history — searchable, paginated list. */
  @Get('history')
  history(@Query() query: DeleteHistoryQueryDto) {
    return this.adminService.list(query);
  }

  /** GET /admin/delete/timeline/:id — audit timeline for one request. */
  @Get('timeline/:id')
  timeline(@Param('id') id: string) {
    return this.adminService.getTimeline(id);
  }

  /** GET /admin/delete/export?format=csv|excel */
  @Get('export')
  async export(@Query() query: DeleteHistoryQueryDto, @Res() res: Response) {
    const { data } = await this.adminService.list({
      ...query,
      page: 1,
      limit: 10_000,
    });

    const headers = [
      'id',
      'userId',
      'userName',
      'userEmail',
      'userMobile',
      'reason',
      'status',
      'createdAt',
      'confirmedAt',
      'retentionUntil',
    ];
    const rows = data.map((r: any) =>
      headers
        .map((h) => this.cell(r[h === 'id' ? '_id' : h]))
        .join(','),
    );
    const csv = [headers.join(','), ...rows].join('\n');

    const isExcel = query.format === 'excel';
    res.setHeader(
      'Content-Type',
      isExcel ? 'application/vnd.ms-excel' : 'text/csv',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="delete-requests.${isExcel ? 'xls' : 'csv'}"`,
    );
    res.send(csv);
  }

  /** POST /admin/delete/approve — force immediate anonymisation. */
  @Post('approve')
  @HttpCode(HttpStatus.OK)
  approve(@GetUser() admin: any, @Body() dto: AdminDeleteActionDto) {
    return this.adminService.approve(dto.deleteRequestId, admin.sub);
  }

  /** POST /admin/delete/reject — restore the account (if policy allows). */
  @Post('reject')
  @HttpCode(HttpStatus.OK)
  reject(@GetUser() admin: any, @Body() dto: AdminDeleteActionDto) {
    return this.adminService.reject(
      dto.deleteRequestId,
      dto.reason ?? '',
      admin.sub,
    );
  }

  private cell(value: any): string {
    if (value === null || value === undefined) return '';
    const s = String(value).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  }
}
