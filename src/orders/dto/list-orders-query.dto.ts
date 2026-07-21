import { IsEnum, IsIn, IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

import { OrderStatus } from '../schemas/order.schema';

/** Query params for GET /orders (admin list) — page/limit/status/sort/search. */
export class ListOrdersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'billAmount', 'totalAmount'])
  sortField?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';

  /** Global search across order #, customer name, and registered mobile number. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  search?: string;
}
