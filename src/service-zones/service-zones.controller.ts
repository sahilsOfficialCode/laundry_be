import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/schemas/user.schema';
import {
  CheckCoverageDto,
  CreateServiceZoneDto,
  SetZoneAvailabilityDto,
  UpdateServiceZoneDto,
} from './dto/service-zone.dto';
import { ServiceZonesService } from './service-zones.service';

@Controller('service-zones')
export class ServiceZonesController {
  constructor(private readonly zonesService: ServiceZonesService) {}

  // ── Public / User ──────────────────────────────────────────────────────────

  /**
   * POST /service-zones/check
   * User sends their pickup coordinates; response tells them if we cover them.
   */
  @Post('check')
  async checkCoverage(@Body() dto: CheckCoverageDto) {
    const result = await this.zonesService.checkCoverage(dto);
    return {
      covered: result.covered,
      distanceKm: result.distanceKm,
      zone: result.zone
        ? {
            id: (result.zone as any)._id,
            zoneName: result.zone.zoneName,
            city: result.zone.city,
            radiusKm: result.zone.radiusKm,
          }
        : null,
      message: result.covered
        ? 'Service is available in your area.'
        : 'Sorry, service is not available in your area yet.',
    };
  }

  // ── Admin ──────────────────────────────────────────────────────────────────

  /**
   * POST /service-zones
   * Admin creates a new service zone.
   * Body: { zoneName, city?, centerLatitude, centerLongitude, radiusKm, isAvailable? }
   */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async create(@Body() dto: CreateServiceZoneDto) {
    return this.zonesService.create(dto);
  }

  /**
   * GET /service-zones
   * Admin lists all zones. Query params: city?, includeUnavailable?
   */
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async findAll(
    @Query('city') city?: string,
    @Query('includeUnavailable') includeUnavailable?: string,
  ) {
    return this.zonesService.findAll(city, includeUnavailable === 'true');
  }

  /**
   * GET /service-zones/:id
   * Admin fetches a single zone by ID.
   */
  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async findOne(@Param('id') id: string) {
    return this.zonesService.findById(id);
  }

  /**
   * PATCH /service-zones/:id
   * Admin updates zone details (name, city, center coordinates, radius).
   */
  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async update(@Param('id') id: string, @Body() dto: UpdateServiceZoneDto) {
    return this.zonesService.update(id, dto);
  }

  /**
   * PATCH /service-zones/:id/availability
   * Admin toggles whether a zone is accepting orders.
   * Body: { isAvailable: true | false }
   */
  @Patch(':id/availability')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async setAvailability(
    @Param('id') id: string,
    @Body() dto: SetZoneAvailabilityDto,
  ) {
    return this.zonesService.setAvailability(id, dto.isAvailable);
  }

  /**
   * DELETE /service-zones/:id
   * Admin permanently removes a zone.
   */
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async remove(@Param('id') id: string) {
    return this.zonesService.remove(id);
  }
}
