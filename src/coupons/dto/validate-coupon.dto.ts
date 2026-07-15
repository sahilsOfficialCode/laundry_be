import { Type } from 'class-transformer';
import { IsNumber, IsString, IsNotEmpty, Min } from 'class-validator';

/** POST /customer/coupon/validate and POST /customer/coupon/apply share this shape. */
export class ValidateCouponDto {
  @IsString()
  @IsNotEmpty()
  couponCode: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  orderAmount: number;
}
