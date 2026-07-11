export interface SmsProvider {
  sendSms(params: { mobileNumber: string; message: string }): Promise<void>;
}
