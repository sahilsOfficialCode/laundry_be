import { IsString, IsNumber, IsOptional, IsBoolean, IsArray, IsIn, Min } from 'class-validator';

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
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;
}
