import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateServiceZoneDto {
  @IsString()
  zoneName: string;

  @IsOptional()
  @IsString()
  city?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  centerLatitude: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  centerLongitude: number;

  /** Radius in km. E.g. 3 means 3 km coverage. */
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(200)
  radiusKm: number;

  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;
}

export class UpdateServiceZoneDto {
  @IsOptional()
  @IsString()
  zoneName?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  centerLatitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  centerLongitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(200)
  radiusKm?: number;
}

export class SetZoneAvailabilityDto {
  @IsBoolean()
  isAvailable: boolean;
}

export class CheckCoverageDto {
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @IsOptional()
  @IsString()
  city?: string;
}
