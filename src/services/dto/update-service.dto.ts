import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsArray,
  IsIn,
  IsInt,
  Min,
  Max,
} from 'class-validator';

export class UpdateServiceDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
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

  @IsOptional()
  @IsBoolean()
  isPopular?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  popularOrder?: number;
}
