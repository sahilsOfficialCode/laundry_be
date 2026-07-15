import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListCouponUsersQueryDto {
  /** Search by name / mobile / email / customer id. */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['active', 'removed'])
  status?: 'active' | 'removed';

  @IsOptional()
  @IsIn(['used', 'unused'])
  usage?: 'used' | 'unused';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
