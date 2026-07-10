import { IsString, IsMongoId, IsNumber, Min, IsNotEmpty } from 'class-validator';

export class RecordCouponUsageDto {
  @IsString()
  @IsNotEmpty()
  couponCode: string;

  @IsMongoId()
  orderId: string;

  @IsNumber()
  @Min(0)
  discountAmount: number;
}
