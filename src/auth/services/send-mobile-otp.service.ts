import { Inject, Injectable } from '@nestjs/common';
import { SMS_PROVIDER } from '../sms/sms-provider.token';
import type { SmsProvider } from '../sms/sms-provider.interface';

@Injectable()
export class SendMobileOtpService {
  constructor(
    @Inject(SMS_PROVIDER)
    private readonly smsProvider: SmsProvider,
  ) {}

  async sendOtp(params: { mobileNumber: string; otp: string }): Promise<void> {
    const message = `Your LaundryBrew OTP is ${params.otp}. It is valid for 5 minutes.`;
    await this.smsProvider.sendSms({
      mobileNumber: params.mobileNumber,
      message,
    });
  }
}
