import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { ReferralService } from './referral.service';

/**
 * Safety net for half-released referral rewards.
 *
 * The reward release loop credits beneficiaries one at a time (referrer, then
 * referee). If the process dies — or a transient DB error fires — after the
 * referrer is credited but before the referee is, the referee's reward is left
 * PENDING with nothing to trigger a retry (the qualifying-order hook only runs
 * on an order status change). This sweep re-runs the release for any referral
 * that qualified yet still has a PENDING reward.
 *
 * Mirrors the payments ReconciliationService: a run guard against overlap, a
 * bootstrap catch-up, and an env kill switch (REFERRAL_RECONCILIATION_ENABLED
 * = 'false'). The actual retry logic lives in ReferralService.
 */
@Injectable()
export class ReferralReconciliationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReferralReconciliationService.name);
  private running = false;

  constructor(
    private readonly referralService: ReferralService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    // Not awaited — must not delay app.listen().
    this.sweep().catch((e) =>
      this.logger.error(
        `Startup referral reconcile failed: ${(e as Error).message}`,
      ),
    );
  }

  @Cron('*/15 * * * *')
  async sweep(): Promise<void> {
    if (this.config.get<string>('REFERRAL_RECONCILIATION_ENABLED') === 'false') {
      return;
    }
    if (this.running) {
      this.logger.warn(
        'Referral reconcile skipped — previous run still in progress',
      );
      return;
    }
    this.running = true;
    try {
      await this.referralService.reconcileStrandedRewards();
    } catch (e) {
      this.logger.error(
        `Referral reconcile sweep failed: ${(e as Error).message}`,
      );
    } finally {
      this.running = false;
    }
  }
}
