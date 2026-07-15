import { IsMongoId, IsNotEmpty, IsString } from 'class-validator';

export class ApplyToOrderDto {
  @IsMongoId()
  orderId: string;

  @IsString()
  @IsNotEmpty()
  couponCode: string;
}
