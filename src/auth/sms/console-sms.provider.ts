import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider } from './sms-provider.interface';

@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger(ConsoleSmsProvider.name);

  async sendSms(params: { mobileNumber: string; message: string }): Promise<void> {
    this.logger.log(`SMS mock sent to ${params.mobileNumber}: ${params.message}`);
  }
}
