import { Injectable } from '@nestjs/common';

/**
 * In-memory counters/gauges for the payment pipeline. Intentionally simple —
 * there is no Prometheus/StatsD collector wired into this app yet, so this
 * is the honest starting point: real numbers, in-process, exposed via
 * GET /payments/metrics. Swapping the internals for a real metrics backend
 * later doesn't require touching any call site, since everything goes
 * through increment()/setGauge().
 */
@Injectable()
export class PaymentMetricsService {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();

  increment(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  snapshot(): { counters: Record<string, number>; gauges: Record<string, number> } {
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
    };
  }
}
