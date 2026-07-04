import { IsOptional, IsString, IsInt, IsBoolean, Min } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class GetServicesFilterDto {
  /** When true, return only admin-selected popular services sorted by popularOrder. */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  popular?: boolean;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
