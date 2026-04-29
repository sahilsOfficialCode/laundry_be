import { Type } from 'class-transformer';
import { IsInt, IsMongoId, Min } from 'class-validator';

export class AddCartItemDto {
  @IsMongoId()
  serviceId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity = 1;
}
