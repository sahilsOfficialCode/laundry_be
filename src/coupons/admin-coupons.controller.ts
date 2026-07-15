import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserRole } from '../users/schemas/user.schema';
import { CouponsAdminService } from './services/coupons-admin.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { ListCouponsQueryDto } from './dto/list-coupons-query.dto';
import { ListCouponUsersQueryDto } from './dto/list-coupon-users-query.dto';
import { AssignUsersDto } from './dto/assign-users.dto';
import { BulkAssignDto } from './dto/bulk-assign.dto';
import { RemoveUserDto } from './dto/remove-user.dto';
import { CouponStatus } from './enums/coupon.enums';

/**
 * Admin coupon management — Marketing > Coupons. Every route requires the
 * ADMIN role (JwtAuthGuard is already global; RolesGuard enforces role).
 * Endpoints match the spec's API list exactly, plus a few extras
 * (dashboard/report/export/audit-logs/reassign) needed by the admin UI.
 */
@Controller('admin/coupons')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminCouponsController {
  constructor(private readonly service: CouponsAdminService) {}

  // ── Fixed-segment routes first so they don't get swallowed by ":id" ──────

  /** GET /admin/coupons/dashboard — active/expired/disabled counts. */
  @Get('dashboard')
  dashboard() {
    return this.service.dashboard();
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────

  /** POST /admin/coupons */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@GetUser() admin: any, @Req() req: Request, @Body() dto: CreateCouponDto) {
    return this.service.create(dto, { adminId: admin.sub, ip: this.getClientIp(req) });
  }

  /** GET /admin/coupons */
  @Get()
  list(@Query() query: ListCouponsQueryDto) {
    return this.service.list(query);
  }

  /** GET /admin/coupons/:id */
  @Get(':id')
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  /** PUT /admin/coupons/:id */
  @Put(':id')
  update(@GetUser() admin: any, @Req() req: Request, @Param('id') id: string, @Body() dto: UpdateCouponDto) {
    return this.service.update(id, dto, { adminId: admin.sub, ip: this.getClientIp(req) });
  }

  /** PATCH /admin/coupons/:id/disable */
  @Patch(':id/disable')
  disable(@GetUser() admin: any, @Req() req: Request, @Param('id') id: string) {
    return this.service.setStatus(id, CouponStatus.DISABLED, { adminId: admin.sub, ip: this.getClientIp(req) });
  }

  /** PATCH /admin/coupons/:id/enable */
  @Patch(':id/enable')
  enable(@GetUser() admin: any, @Req() req: Request, @Param('id') id: string) {
    return this.service.setStatus(id, CouponStatus.ACTIVE, { adminId: admin.sub, ip: this.getClientIp(req) });
  }

  /** DELETE /admin/coupons/:id — soft delete. */
  @Delete(':id')
  remove(@GetUser() admin: any, @Req() req: Request, @Param('id') id: string) {
    return this.service.softDelete(id, { adminId: admin.sub, ip: this.getClientIp(req) });
  }

  // ── Assignment ───────────────────────────────────────────────────────────

  /** POST /admin/coupons/:id/assign-users — manual selection. */
  @Post(':id/assign-users')
  @HttpCode(HttpStatus.OK)
  assignUsers(@GetUser() admin: any, @Req() req: Request, @Param('id') id: string, @Body() dto: AssignUsersDto) {
    return this.service.assignUsersManual(id, dto, { adminId: admin.sub, ip: this.getClientIp(req) });
  }

  /** POST /admin/coupons/:id/bulk-assign — condition-based bulk selection. */
  @Post(':id/bulk-assign')
  @HttpCode(HttpStatus.OK)
  bulkAssign(@GetUser() admin: any, @Req() req: Request, @Param('id') id: string, @Body() dto: BulkAssignDto) {
    return this.service.bulkAssign(id, dto, { adminId: admin.sub, ip: this.getClientIp(req) });
  }

  /** POST /admin/coupons/:id/remove-user */
  @Post(':id/remove-user')
  @HttpCode(HttpStatus.OK)
  removeUser(@GetUser() admin: any, @Req() req: Request, @Param('id') id: string, @Body() dto: RemoveUserDto) {
    return this.service.removeUser(id, dto.userId, { adminId: admin.sub, ip: this.getClientIp(req) });
  }

  /** POST /admin/coupons/:id/reassign-user */
  @Post(':id/reassign-user')
  @HttpCode(HttpStatus.OK)
  reassignUser(@GetUser() admin: any, @Req() req: Request, @Param('id') id: string, @Body() dto: RemoveUserDto) {
    return this.service.reassignUser(id, dto.userId, { adminId: admin.sub, ip: this.getClientIp(req) });
  }

  /** GET /admin/coupons/:id/users — paginated, searchable assigned-user table. */
  @Get(':id/users')
  listUsers(@Param('id') id: string, @Query() query: ListCouponUsersQueryDto) {
    return this.service.listUsers(id, query);
  }

  /** GET /admin/coupons/:id/users/export — CSV export of assigned users. */
  @Get(':id/users/export')
  async exportUsers(@Param('id') id: string, @Res() res: Response) {
    const { filename, csv } = await this.service.exportUsersCsv(id);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }

  // ── Reports & audit ──────────────────────────────────────────────────────

  /** GET /admin/coupons/:id/report — assigned/used/remaining/discount stats. */
  @Get(':id/report')
  report(@Param('id') id: string) {
    return this.service.report(id);
  }

  /** GET /admin/coupons/:id/audit-logs */
  @Get(':id/audit-logs')
  auditLogs(@Param('id') id: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.auditLogs(id, page ? Number(page) : 1, limit ? Number(limit) : 50);
  }

  private getClientIp(req: Request): string | undefined {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length > 0) {
      return fwd.split(',')[0].trim() || req.ip || undefined;
    }
    return req.ip || undefined;
  }
}
