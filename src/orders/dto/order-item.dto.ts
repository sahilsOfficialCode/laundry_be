import { Type } from 'class-transformer';
import { IsInt, IsMongoId, Min } from 'class-validator';

export class OrderItemDto {
  @IsMongoId()
  serviceId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;
}
