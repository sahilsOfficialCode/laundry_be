import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { Referral, ReferralDocument } from '../schemas/referral.schema';
import { ReferralRepository } from '../repositories/referral.repository';
import { ReferralSettings } from '../schemas/referral-settings.schema';
import { FraudReason } from '../enums/referral.enums';
import { ReferralContext } from '../types/referral.types';

export interface FraudEvaluation {
  blocked: boolean;
  reasons: FraudReason[];
}

/**
 * Rule-based fraud engine evaluated at referral apply-time.
 *
 * Signals: self-referral, same device/IP, duplicate phone/email, emulator,
 * fake GPS, VPN, and velocity (multiple accounts from one fingerprint).
 * Device/IP/VPN checks respect the admin toggles in settings.
 */
@Injectable()
export class FraudDetectionService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Referral.name)
    private readonly referralModel: Model<ReferralDocument>,
    private readonly repo: ReferralRepository,
  ) {}

  /**
   * Evaluate a prospective referral. Persists a fraud_log when any signal
   * fires so the admin has a record even for blocked attempts.
   */
  async evaluate(params: {
    referrerId: string;
    refereeId: string;
    code: string;
    context: ReferralContext;
    settings: ReferralSettings;
  }): Promise<FraudEvaluation> {
    const { referrerId, refereeId, code, context, settings } = params;
    const reasons = new Set<FraudReason>();

    // 1. Self-referral — a user cannot refer themselves.
    if (referrerId === refereeId) reasons.add(FraudReason.SELF_REFERRAL);

    // 2. Device-level checks (emulator / fake GPS / VPN).
    if (context.isEmulator) reasons.add(FraudReason.EMULATOR);
    if (context.isFakeGps) reasons.add(FraudReason.FAKE_GPS);
    if (settings.vpnDetectionEnabled && context.isVpn)
      reasons.add(FraudReason.VPN);

    // 3. Same device already used for another referral.
    if (settings.blockSameDevice && context.deviceId) {
      const dupDevice = await this.referralModel.countDocuments({
        deviceId: context.deviceId,
        refereeId: { $ne: refereeId },
      });
      if (dupDevice > 0) reasons.add(FraudReason.SAME_DEVICE);
    }

    // 4. Same IP already used for another referral.
    if (settings.blockSameIp && context.ipAddress) {
      const dupIp = await this.referralModel.countDocuments({
        ipAddress: context.ipAddress,
        refereeId: { $ne: refereeId },
      });
      // A shared NAT/office IP is weaker than a device match → threshold >1.
      if (dupIp >= 3) reasons.add(FraudReason.SAME_IP);
    }

    // 5. Duplicate phone / email pointing to another existing account.
    if (context.phone) {
      const dup = await this.userModel.countDocuments({
        mobileNumber: context.phone,
        _id: { $ne: refereeId },
      });
      if (dup > 0) reasons.add(FraudReason.SAME_PHONE);
    }
    if (context.email) {
      const dup = await this.userModel.countDocuments({
        email: context.email.toLowerCase(),
        _id: { $ne: refereeId },
      });
      if (dup > 0) reasons.add(FraudReason.SAME_EMAIL);
    }

    // 6. Velocity — many accounts from the same device (multi-accounting).
    if (context.deviceId) {
      const sameDeviceAccounts = await this.referralModel.countDocuments({
        deviceId: context.deviceId,
      });
      if (sameDeviceAccounts >= 3) reasons.add(FraudReason.MULTIPLE_ACCOUNTS);
    }

    const reasonList = Array.from(reasons);
    const blocked = reasonList.length > 0; // any hard signal blocks

    if (reasonList.length > 0) {
      await this.repo.writeFraudLog({
        refereeId,
        referrerId,
        code,
        reasons: reasonList,
        blocked,
        deviceId: context.deviceId,
        ipAddress: context.ipAddress,
        phone: context.phone,
        email: context.email,
      });
    }

    return { blocked, reasons: reasonList };
  }

  /** Fraud rate across all evaluated attempts (for analytics). */
  async fraudRate(totalReferrals: number): Promise<number> {
    if (totalReferrals <= 0) return 0;
    const blocked = await this.repo.countFraudLogs({ blocked: true });
    return Number(((blocked / (totalReferrals + blocked)) * 100).toFixed(2));
  }
}
