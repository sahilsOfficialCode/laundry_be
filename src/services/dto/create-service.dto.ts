import { IsString, IsNumber, IsNotEmpty, IsOptional, IsBoolean, IsArray, IsIn, IsInt, Min, Max } from 'class-validator';

export class CreateServiceDto {
  @IsString()
  name?: string;

  @IsNumber()
  @Min(0)
  price?: number;

  @IsString()
  @IsNotEmpty()
  instantDescription?: string;

  @IsString()
  @IsNotEmpty()
  scheduledDescription?: string;

  @IsString()
  @IsNotEmpty()
  instantOrderPlacedMessage?: string;

  @IsString()
  @IsNotEmpty()
  scheduledOrderPlacedMessage?: string;

  @IsOptional()
  @IsArray()
  @IsIn(['instant', 'scheduled'], { each: true })
  categories?: string[];

  @IsOptional()
  @IsString()
  instantDuration?: string;

  @IsOptional()
  @IsString()
  scheduledDuration?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  turnaroundHours?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  instantTurnaroundMinutes?: number;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @IsOptional()
  @IsBoolean()
  isPopular?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  popularOrder?: number;
}
