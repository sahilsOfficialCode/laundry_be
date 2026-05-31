import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DayOfWeek, PaymentMethod, ServiceAreaType } from '../schemas/location.schema';

export class GeoPointDto {
  @IsNumber()
  latitude: number;

  @IsNumber()
  longitude: number;
}

export class DayScheduleDto {
  @IsEnum(DayOfWeek)
  day: DayOfWeek;

  @IsBoolean()
  isOpen: boolean;

  @IsOptional()
  @IsString()
  openTime?: string;

  @IsOptional()
  @IsString()
  closeTime?: string;
}

export class TimeSlotDto {
  @IsString()
  label: string;

  @IsString()
  startTime: string;

  @IsString()
  endTime: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  capacity?: number;
}

export class CreateLocationDto {
  @IsString()
  shopName: string;

  @IsString()
  city: string;

  @IsString()
  fullAddress: string;

  @IsString()
  contactNumber: string;

  @ValidateNested()
  @Type(() => GeoPointDto)
  geoPoint: GeoPointDto;

  @IsEnum(ServiceAreaType)
  serviceAreaType: ServiceAreaType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  serviceRadiusKm?: number;

  @IsOptional()
  @IsArray()
  servicePolygon?: number[][][];

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsArray()
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

  @IsNumber()
  @Min(1)
  dailyBookingLimit: number;

  @IsOptional()
  @IsString()
  pricingProfileKey?: string;

  @IsOptional()
  @IsArray()
  supportedServiceIds?: string[];

  @IsOptional()
  @IsArray()
  @IsEnum(PaymentMethod, { each: true })
  enabledPaymentMethods?: PaymentMethod[];
}

export class UpdateLocationDto extends CreateLocationDto {}

export class SetLocationStatusDto {
  @IsBoolean()
  isActive: boolean;
}

export class CreateClosureDto {
  @IsString()
  startDate: string;

  @IsString()
  endDate: string;

  @IsString()
  reason: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdateClosureDto {
  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
