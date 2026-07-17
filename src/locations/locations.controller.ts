import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
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
import { GeocodeQueryDto } from './dto/geocode.dto';
import { LocationsService } from './locations.service';

@Controller('locations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  /** POST /locations — Admin creates a single location manually */
  @Post()
  @Roles(UserRole.ADMIN)
  async createLocation(@Body() dto: CreateLocationDto, @GetUser() actor: any) {
    return this.locationsService.createLocation(dto, actor);
  }

  /**
   * POST /locations/import
   * Admin uploads a JSON file containing an array of location objects.
   * Returns { imported, failed, errors[] }.
   *
   * Minimal row shape:
   * {
   *   "shopName": "Bright Wash", "city": "Malappuram",
   *   "fullAddress": "NH 66, Ponnani", "contactNumber": "+919876543210",
   *   "latitude": 10.7867, "longitude": 75.9999,
   *   "serviceAreaType": "radius", "serviceRadiusKm": 5
   * }
   */
  @Post('import')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.originalname.match(/\.json$/i)) {
          return cb(new BadRequestException('Only .json files are accepted'), false);
        }
        cb(null, true);
      },
    }),
  )
  async importLocations(
    @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined,
    @GetUser() actor: any,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded — send a .json file in the "file" field');
    }
    return this.locationsService.bulkImportFromJson(file.buffer, actor);
  }

  /**
   * POST /locations/geocode
   * Admin submits a free-text address/place; gets lat/lng candidates from
   * OpenStreetMap Nominatim (no API key required).
   * Body: { query: "Mappala House, Ponnani", city?: "Malappuram", limit?: 5 }
   */
  @Post('geocode')
  @Roles(UserRole.ADMIN)
  async geocodeAddress(@Body() dto: GeocodeQueryDto) {
    return this.locationsService.geocodeAddress(dto);
  }

  /**
   * GET /locations/serviceability?latitude=&longitude=&date=&city=&preferredLocationId=
   * Public — returns the nearest eligible branch's slots and payment methods.
   * Used by the frontend checkout flow.
   *
   * Optional preferredLocationId: when supplied the resolver promotes that
   * branch to the top of the candidate list (e.g. user already picked a shop
   * in the "Drop at Shop" flow and we want its specific slots).
   */
  @Public()
  @Get('serviceability')
  async getServiceability(
    @Query('latitude') latitude: string,
    @Query('longitude') longitude: string,
    @Query('date') date: string,
    @Query('city') city?: string,
    @Query('preferredLocationId') preferredLocationId?: string,
  ) {
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lng)) {
      throw new BadRequestException('latitude and longitude are required');
    }
    return this.locationsService.getServiceability(
      lat,
      lng,
      date ?? new Date().toISOString().slice(0, 10),
      city,
      preferredLocationId,
    );
  }

  /**
   * GET /locations/shops?latitude=&longitude=&date=&city=
   * Public — returns active shops, ordered by distance when coordinates are
   * given. latitude/longitude are optional: omitting both returns a
   * name-sorted browse-all list (optionally narrowed by city) so a customer
   * with no saved address and no GPS permission can still pick a branch.
   * Used by the "Drop at Shop" flow.
   */
  @Public()
  @Get('shops')
  async getNearbyShops(
    @Query('latitude') latitude?: string,
    @Query('longitude') longitude?: string,
    @Query('date') date?: string,
    @Query('city') city?: string,
  ) {
    const hasLat = latitude !== undefined && latitude !== '';
    const hasLng = longitude !== undefined && longitude !== '';

    let lat: number | undefined;
    let lng: number | undefined;

    if (hasLat || hasLng) {
      lat = parseFloat(latitude!);
      lng = parseFloat(longitude!);
      if (isNaN(lat) || isNaN(lng)) {
        throw new BadRequestException('latitude and longitude must both be valid numbers when provided');
      }
    }

    return this.locationsService.getNearbyShops(lat, lng, date ?? new Date().toISOString().slice(0, 10), city);
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

  /**
   * GET /locations/:id/capacity?date=YYYY-MM-DD
   * Returns today's booking count vs. the daily limit for the admin panel.
   * Response: { limit, usedToday, remainingToday, isUnlimited, isFull }
   */
  @Get(':id/capacity')
  @Roles(UserRole.ADMIN)
  async getCapacity(
    @Param('id') locationId: string,
    @Query('date') date: string,
  ) {
    return this.locationsService.getCapacityStats(
      locationId,
      date ?? new Date().toISOString().slice(0, 10),
    );
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
