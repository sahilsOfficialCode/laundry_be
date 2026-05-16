import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Razorpay from 'razorpay';
import * as crypto from 'crypto';

@Injectable()
export class PaymentsService {
  private razorpay: any;

  constructor(private configService: ConfigService) {
    const keyId = this.configService.get<string>('RAZORPAY_KEY_ID');
    const keySecret = this.configService.get<string>('RAZORPAY_KEY_SECRET');

    if (!keyId || !keySecret) {
      throw new Error('RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is missing in .env');
    }

    this.razorpay = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });
  }

  async createOrder(amount: number, receiptId: string) {
    const options = {
      amount: Math.round(amount * 100), // amount in the smallest currency unit (paise)
      currency: 'INR',
      receipt: receiptId,
    };

    try {
      const order = await this.razorpay.orders.create(options);
      return order;
    } catch (error) {
      throw new InternalServerErrorException('Failed to create Razorpay order');
    }
  }

  verifyPayment(
    razorpayOrderId: string,
    razorpayPaymentId: string,
    signature: string,
  ): boolean {
    const keySecret = this.configService.get<string>('RAZORPAY_KEY_SECRET');
    
    if (!keySecret) {
      throw new InternalServerErrorException('Razorpay secret key not configured');
    }

    const generatedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(razorpayOrderId + '|' + razorpayPaymentId)
      .digest('hex');

    return generatedSignature === signature;
  }
}
