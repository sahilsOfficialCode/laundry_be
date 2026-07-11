import {
  IsString,
  IsEnum,
  IsOptional,
  IsBoolean,
  IsArray,
  IsNumber,
  IsInt,
  Min,
  Matches,
  ArrayNotEmpty,
} from 'class-validator';
import { SlotType, DayOfWeek } from '../schemas/standard-time-slot.schema';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateStandardTimeSlotDto {
  @IsString()
  label: string;

  @Matches(TIME_RE, { message: 'startTime must be HH:MM (24h)' })
  startTime: string;

  @Matches(TIME_RE, { message: 'endTime must be HH:MM (24h)' })
  endTime: string;

  @IsEnum(SlotType)
  @IsOptional()
  type?: SlotType;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsOptional()
  daysAvailable?: DayOfWeek[];

  @IsNumber()
  @Min(1)
  @IsOptional()
  capacity?: number;

  @IsString()
  @IsOptional()
  expectedTurnaround?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;
}

export class UpdateStandardTimeSlotDto {
  @IsString()
  @IsOptional()
  label?: string;

  @Matches(TIME_RE, { message: 'startTime must be HH:MM (24h)' })
  @IsOptional()
  startTime?: string;

  @Matches(TIME_RE, { message: 'endTime must be HH:MM (24h)' })
  @IsOptional()
  endTime?: string;

  @IsEnum(SlotType)
  @IsOptional()
  type?: SlotType;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsOptional()
  daysAvailable?: DayOfWeek[];

  @IsNumber()
  @Min(1)
  @IsOptional()
  capacity?: number;

  @IsString()
  @IsOptional()
  expectedTurnaround?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;
}
