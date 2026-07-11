import { Injectable, Logger } from '@nestjs/common';

/**
 * Alerting is log-based for now: every raise() emits a structured, grep-able
 * warn/error line. There is no Slack/PagerDuty/email integration configured
 * anywhere in this project (no webhook URL or API key in .env) — wiring one
 * up is flagged as remaining work rather than faked here. In the meantime,
 * any log pipeline (CloudWatch, Loki, etc.) can alert on `"alert":true`.
 */
@Injectable()
export class PaymentAlertsService {
  private readonly logger = new Logger('PaymentAlert');

  raise(type: string, context: Record<string, any> = {}): void {
    this.logger.warn(
      JSON.stringify({ alert: true, type, ...context, timestamp: new Date().toISOString() }),
    );
  }
}
