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
    const base = `Your LaundryBrew OTP is ${params.otp}. It is valid for 5 minutes.`;

    // For Android SMS Retriever auto-fill, the message must start with "<#>"
    // and end with the app's 11-char signature hash. Configure the hash via
    // ANDROID_SMS_APP_HASH (obtain it from the Flutter OtpAutofillService
    // .appSignature()). When unset, a plain OTP SMS is sent (no auto-read).
    const appHash = process.env.ANDROID_SMS_APP_HASH?.trim();
    const message = appHash ? `<#> ${base}\n${appHash}` : base;

    await this.smsProvider.sendSms({
      mobileNumber: params.mobileNumber,
      message,
    });
  }
}
