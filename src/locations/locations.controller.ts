import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/schemas/user.schema';
import {
  CreateLocationDto,
  SetLocationStatusDto,
  UpdateLocationDto,
} from './dto/location.dto';
import {
  CreateLocationClosureDto,
  UpdateLocationClosureDto,
} from './dto/location-closure.dto';
import { ListAuditLogsQueryDto, ListLocationsQueryDto } from './dto/list-locations.dto';
import { EligibleLocationCheckDto, ResolveLocationDto } from './dto/resolve-location.dto';
import { LocationsService } from './locations.service';

@Controller('locations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  async createLocation(@Body() dto: CreateLocationDto, @GetUser() actor: any) {
    return this.locationsService.createLocation(dto, actor);
  }

  @Get()
  @Roles(UserRole.ADMIN)
  async listLocations(@Query() query: ListLocationsQueryDto) {
    return this.locationsService.listLocations(query);
  }

  @Post('resolve')
  async resolveLocation(@Body() dto: ResolveLocationDto) {
    return this.locationsService.resolveLocation(dto);
  }

  @Post('availability/check')
  async checkBookingEligibility(@Body() dto: EligibleLocationCheckDto) {
    const selectedLocation =
      await this.locationsService.validateBookingEligibility(dto);
    return {
      eligible: true,
      location: selectedLocation,
    };
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  async getLocation(@Param('id') locationId: string) {
    return this.locationsService.getLocationById(locationId);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  async updateLocation(
    @Param('id') locationId: string,
    @Body() dto: UpdateLocationDto,
    @GetUser() actor: any,
  ) {
    return this.locationsService.updateLocation(locationId, dto, actor);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  async setLocationStatus(
    @Param('id') locationId: string,
    @Body() dto: SetLocationStatusDto,
    @GetUser() actor: any,
  ) {
    return this.locationsService.setLocationStatus(locationId, dto, actor);
  }

  @Get(':id/closures')
  @Roles(UserRole.ADMIN)
  async listClosures(@Param('id') locationId: string) {
    return this.locationsService.listClosures(locationId);
  }

  @Post(':id/closures')
  @Roles(UserRole.ADMIN)
  async createClosure(
    @Param('id') locationId: string,
    @Body() dto: CreateLocationClosureDto,
    @GetUser() actor: any,
  ) {
    return this.locationsService.createClosure(locationId, dto, actor);
  }

  @Patch(':id/closures/:closureId')
  @Roles(UserRole.ADMIN)
  async updateClosure(
    @Param('id') locationId: string,
    @Param('closureId') closureId: string,
    @Body() dto: UpdateLocationClosureDto,
    @GetUser() actor: any,
  ) {
    return this.locationsService.updateClosure(locationId, closureId, dto, actor);
  }

  @Get(':id/audit-logs')
  @Roles(UserRole.ADMIN)
  async listAuditLogs(
    @Param('id') locationId: string,
    @Query() query: ListAuditLogsQueryDto,
  ) {
    return this.locationsService.listAuditLogs(
      locationId,
      query.page,
      query.limit,
    );
  }
}
