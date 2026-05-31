import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { LocationsService } from './locations.service';
import {
  CreateClosureDto,
  CreateLocationDto,
  SetLocationStatusDto,
  UpdateClosureDto,
  UpdateLocationDto,
} from './dto/location.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/schemas/user.schema';
import { CheckoutServiceType } from '../orders/dto/checkout.dto';

@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get()
  findAll(
    @Query('city') city?: string,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.locationsService.findAll({
      city,
      search,
      page: Number(page || 1),
      limit: Number(limit || 20),
      includeInactive: includeInactive === 'true',
    });
  }

  @Get('shops')
  listShops(
    @Query('latitude') latitude?: string,
    @Query('longitude') longitude?: string,
    @Query('date') date?: string,
  ) {
    return this.locationsService.listAvailableShops({
      latitude: latitude ? Number(latitude) : undefined,
      longitude: longitude ? Number(longitude) : undefined,
      date,
    });
  }

  @Get('serviceability')
  serviceability(
    @Query('serviceType') serviceType: CheckoutServiceType,
    @Query('latitude') latitude: string,
    @Query('longitude') longitude: string,
    @Query('date') date: string,
  ) {
    return this.locationsService.findEligibleShop({
      serviceType,
      latitude: Number(latitude),
      longitude: Number(longitude),
      date,
    });
  }

  @Get('checkout-options')
  checkoutOptions(
    @Query('serviceType') serviceType: CheckoutServiceType,
    @Query('date') date: string,
    @Query('selectedShopId') selectedShopId?: string,
    @Query('latitude') latitude?: string,
    @Query('longitude') longitude?: string,
  ) {
    return this.locationsService.getCheckoutOptions({
      serviceType,
      selectedShopId,
      latitude: latitude ? Number(latitude) : undefined,
      longitude: longitude ? Number(longitude) : undefined,
      date,
    });
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  create(@Body() dto: CreateLocationDto) {
    return this.locationsService.create(dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  update(@Param('id') id: string, @Body() dto: Partial<UpdateLocationDto>) {
    return this.locationsService.update(id, dto);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  setStatus(@Param('id') id: string, @Body() dto: SetLocationStatusDto) {
    return this.locationsService.setStatus(id, dto.isActive);
  }

  @Get(':id/closures')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  getClosures(@Param('id') id: string) {
    return this.locationsService.findClosures(id);
  }

  @Post(':id/closures')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  createClosure(@Param('id') id: string, @Body() dto: CreateClosureDto) {
    return this.locationsService.createClosure(id, dto);
  }

  @Patch(':id/closures/:closureId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  updateClosure(
    @Param('id') id: string,
    @Param('closureId') closureId: string,
    @Body() dto: UpdateClosureDto,
  ) {
    return this.locationsService.updateClosure(id, closureId, dto);
  }
}
