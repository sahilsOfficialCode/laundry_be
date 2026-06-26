import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { StandardTimeSlotsService } from './standard-time-slots.service';
import {
  CreateStandardTimeSlotDto,
  UpdateStandardTimeSlotDto,
} from './dto/standard-time-slot.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/schemas/user.schema';

@Controller('standard-time-slots')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StandardTimeSlotsController {
  constructor(private readonly svc: StandardTimeSlotsService) {}

  // ── User-facing (any authenticated user) ──────────────────────────────────

  /**
   * GET /standard-time-slots/available?date=YYYY-MM-DD
   * Returns pickup slots + delivery slots including the Instant option.
   * Mobile app calls this on the scheduling screen.
   * Past-time filtering is applied automatically for today's date.
   */
  @Get('available')
  getAvailable(@Query('date') date: string) {
    return this.svc.getAvailable(date);
  }

  // ── Admin only ─────────────────────────────────────────────────────────────

  /**
   * GET /standard-time-slots/stats?date=YYYY-MM-DD
   * All slots with order counts for the given date.
   * Used by the admin Time Slots page to show slot utilisation.
   */
  @Get('stats')
  @Roles(UserRole.ADMIN)
  getStats(@Query('date') date: string) {
    return this.svc.getStats(date);
  }

  /**
   * POST /standard-time-slots
   * Create a new standard time slot.
   */
  @Post()
  @Roles(UserRole.ADMIN)
  create(@Body() dto: CreateStandardTimeSlotDto) {
    return this.svc.create(dto);
  }

  /**
   * GET /standard-time-slots
   * List all slots (active and inactive).
   */
  @Get()
  @Roles(UserRole.ADMIN)
  findAll() {
    return this.svc.findAll();
  }

  /**
   * GET /standard-time-slots/:id
   * Get a single slot by ID.
   */
  @Get(':id')
  @Roles(UserRole.ADMIN)
  findOne(@Param('id') id: string) {
    return this.svc.findById(id);
  }

  /**
   * PATCH /standard-time-slots/:id
   * Update any fields of a slot.
   */
  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateStandardTimeSlotDto) {
    return this.svc.update(id, dto);
  }

  /**
   * PATCH /standard-time-slots/:id/toggle
   * Toggle isActive.
   *
   * Body: { isActive: boolean, graceMinutes?: number }
   * When deactivating (isActive=false) with graceMinutes > 0, the slot remains
   * visible to users for that many minutes so in-progress checkouts can complete.
   */
  @Patch(':id/toggle')
  @Roles(UserRole.ADMIN)
  toggle(
    @Param('id') id: string,
    @Body('isActive') isActive: boolean,
    @Body('graceMinutes') graceMinutes?: number,
  ) {
    return this.svc.setActive(id, isActive, graceMinutes ?? 0);
  }

  /**
   * DELETE /standard-time-slots/:id
   * Permanently delete a slot.
   */
  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
