import { IsString, IsNumber, IsOptional, IsBoolean, IsArray, IsIn, IsInt, Min, Max } from 'class-validator';

export class CreateServiceDto {
  @IsString()
  name?: string;

  @IsNumber()
  @Min(0)
  price?: number;

  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsIn(['instant', 'scheduled'], { each: true })
  categories?: string[];

  @IsOptional()
  @IsString()
  duration?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  turnaroundHours?: number;

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
