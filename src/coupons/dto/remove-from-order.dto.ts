import { IsMongoId } from 'class-validator';

export class RemoveFromOrderDto {
  @IsMongoId()
  orderId: string;
}
