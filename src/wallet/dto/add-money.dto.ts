import { IsNumber, IsString, Min } from 'class-validator';

export class CreateAddMoneyOrderDto {
  @IsNumber()
  @Min(1)
  amount: number;
}

export class VerifyAddMoneyDto {
  @IsString()
  walletTxnId: string;

  @IsString()
  razorpayOrderId: string;

  @IsString()
  razorpayPaymentId: string;

  @IsString()
  razorpaySignature: string;
}
