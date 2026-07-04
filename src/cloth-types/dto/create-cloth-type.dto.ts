import { IsNumber, IsOptional, IsString, IsBoolean } from 'class-validator';

export class CreateClothTypeDto {
  @IsString()
  name: string;

  @IsNumber()
  rate: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
