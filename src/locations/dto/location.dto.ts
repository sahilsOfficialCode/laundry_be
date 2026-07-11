import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DayOfWeek, ServiceAreaType } from '../schemas/location.schema';

@ValidatorConstraint({ name: 'IsValidBranchGeoPoint', async: false })
class IsValidBranchGeoPointConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const geoPoint = value as Partial<GeoPointDto>;
    return (
      typeof geoPoint.latitude === 'number' &&
      Number.isFinite(geoPoint.latitude) &&
      typeof geoPoint.longitude === 'number' &&
      Number.isFinite(geoPoint.longitude) &&
      !(geoPoint.latitude === 0 && geoPoint.longitude === 0)
    );
  }

  defaultMessage() {
    return 'geoPoint.latitude and geoPoint.longitude are required finite numbers and cannot both be 0';
  }
}

export class GeoPointDto {
  @Type(() => Number)
  @IsDefined({ message: 'geoPoint.latitude is required' })
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: 'geoPoint.latitude must be a finite number' },
  )
  @Min(-90)
  @Max(90)
  latitude: number;

  @Type(() => Number)
  @IsDefined({ message: 'geoPoint.longitude is required' })
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: 'geoPoint.longitude must be a finite number' },
  )
  @Min(-180)
  @Max(180)
  longitude: number;
}

export class DayScheduleDto {
  @IsEnum(DayOfWeek)
  day: DayOfWeek;

  @IsBoolean()
  isOpen: boolean;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  openTime?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  closeTime?: string;
}

export class TimeSlotDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  label: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  startTime: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  endTime: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  capacity?: number;
}

export class CreateLocationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  shopName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  city: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  fullAddress: string;

  @IsOptional()
  @Matches(/^\+?[0-9]{8,15}$/, { message: 'contactNumber must be 8–15 digits, optionally prefixed with +' })
  contactNumber?: string;

  @IsDefined({ message: 'geoPoint is required' })
  @Validate(IsValidBranchGeoPointConstraint)
  @ValidateNested()
  @Type(() => GeoPointDto)
  geoPoint: GeoPointDto;

  @IsEnum(ServiceAreaType)
  serviceAreaType: ServiceAreaType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.5)
  @Max(100)
  serviceRadiusKm?: number;

  @IsOptional()
  @IsArray()
  servicePolygon?: number[][][];

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DayScheduleDto)
  workingSchedule: DayScheduleDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TimeSlotDto)
  pickupSlots: TimeSlotDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TimeSlotDto)
  deliverySlots: TimeSlotDto[];

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5000)
  dailyBookingLimit: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  pricingProfileKey?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  supportedServiceIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  enabledPaymentMethods?: string[];
}

export class UpdateLocationDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  shopName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  fullAddress?: string;

  @IsOptional()
  @Matches(/^\+?[0-9]{8,15}$/)
  contactNumber?: string;

  @IsOptional()
  @Validate(IsValidBranchGeoPointConstraint)
  @ValidateNested()
  @Type(() => GeoPointDto)
  geoPoint?: GeoPointDto;

  @IsOptional()
  @IsEnum(ServiceAreaType)
  serviceAreaType?: ServiceAreaType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.5)
  @Max(100)
  serviceRadiusKm?: number;

  @IsOptional()
  @IsArray()
  servicePolygon?: number[][][];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DayScheduleDto)
  workingSchedule?: DayScheduleDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TimeSlotDto)
  pickupSlots?: TimeSlotDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TimeSlotDto)
  deliverySlots?: TimeSlotDto[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5000)
  dailyBookingLimit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  pricingProfileKey?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  supportedServiceIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  enabledPaymentMethods?: string[];
}

export class SetLocationStatusDto {
  @IsBoolean()
  isActive: boolean;
}
