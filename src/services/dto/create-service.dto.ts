import { IsString, IsNumber, IsOptional, IsBoolean, Min } from 'class-validator';

// export class CreateServiceDto {
//   @IsString()
//   name: string;

//   @IsNumber()
//   @Min(0)
//   price: number;

//   @IsString()
//   description: string;

// }

export class CreateServiceDto {
  @IsString()
  name?: string;

  @IsNumber()
  @Min(0)
  price?: number;

  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  category?: string;

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
