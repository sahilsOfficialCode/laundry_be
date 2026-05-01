import { IsMongoId, IsInt, Min } from 'class-validator';

export class AddToCartDto {
  @IsMongoId()
  serviceId: string;

  @IsInt()
  @Min(1)
  quantity: number;
}
