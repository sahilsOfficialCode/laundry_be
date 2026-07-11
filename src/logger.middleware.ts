import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  private logger = new Logger('HTTP');

  use(request: Request, response: Response, next: NextFunction): void {
    const { method, originalUrl, body } = request;
    const userAgent = request.get('user-agent') || '';
    // Payment routes carry customer PII (email/phone/VPA in webhook
    // payloads) and signatures — never let them flow into general
    // console/access logs wholesale. Structured, PII-free payment logging
    // already happens in PaymentFinalizationService/RazorpayWebhookService.
    const isPaymentsRoute = originalUrl.startsWith('/payments');

    response.on('finish', () => {
      const { statusCode } = response;
      const bodyForLog = isPaymentsRoute ? '[redacted:payments]' : JSON.stringify(body || {});
      this.logger.log(
        `${method} ${originalUrl} ${statusCode} - ${userAgent} (Body: ${bodyForLog})`
      );
    });

    next();
  }
}
