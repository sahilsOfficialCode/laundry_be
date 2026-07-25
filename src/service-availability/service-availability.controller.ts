import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ServiceAvailabilityService } from './service-availability.service';
import { UpdateServiceAvailabilityDto } from './dto/update-service-availability.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/schemas/user.schema';

@Controller('service-availability')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ServiceAvailabilityController {
  constructor(private readonly service: ServiceAvailabilityService) {}

  /** GET /service-availability — any authenticated user (customer app checks this before showing Instant/Scheduled options). */
  @Get()
  getConfig() {
    return this.service.getConfig();
  }

  /** PATCH /service-availability — admin only. */
  @Patch()
  @Roles(UserRole.ADMIN)
  updateConfig(@Body() dto: UpdateServiceAvailabilityDto) {
    return this.service.updateConfig(dto);
  }
}
