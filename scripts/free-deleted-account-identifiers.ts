/**
 * One-off migration for the "permanent deletion" architecture change.
 *
 * Before this change, a permanently-deleted account kept its `email` /
 * `mobileNumber` on the User row until the 30-day retention cleanup job
 * (`AccountCleanupService.anonymize()`) ran — which meant the same email/phone
 * could not register a new account for up to 30 days, and (for phone) the old
 * deleted account was returned by the mobile login lookup.
 *
 * `AccountDeletionService.executeDeletion()` now releases those identifiers at
 * deletion time. This script does the same for accounts that were already
 * deleted before the change:
 *
 *   for every user with isDeleted = true that still has an email/mobileNumber:
 *     1. snapshot email/mobile onto its DeleteRequest (userEmail/userMobile)
 *        if not already captured, so admin search / audit still works;
 *     2. $unset email, mobileNumber, password, passwordResetToken,
 *        passwordResetExpiresAt on the user.
 *
 * It does NOT touch active users, order/payment/invoice/audit records, or the
 * anonymize() cron (which keeps scrubbing residual PII — name, addresses,
 * photo — after the retention window and is a no-op for identifiers already
 * removed here).
 *
 * Safe to re-run (idempotent). Add `--dry-run` to only report.
 *
 * Run with:
 *   npx ts-node -r tsconfig-paths/register scripts/free-deleted-account-identifiers.ts [--dry-run]
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppModule } from '../src/app.module';
import { User, UserDocument } from '../src/users/schemas/user.schema';
import {
  DeleteRequest,
  DeleteRequestDocument,
} from '../src/account-deletion/schemas/delete-request.schema';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    const requestModel = app.get<Model<DeleteRequestDocument>>(
      getModelToken(DeleteRequest.name),
    );

    const stale = await userModel
      .find({
        isDeleted: true,
        $or: [
          { email: { $exists: true, $ne: null } },
          { mobileNumber: { $exists: true, $ne: null } },
        ],
      })
      .select('_id email mobileNumber');

    console.log(
      `${dryRun ? '[dry-run] ' : ''}Found ${stale.length} deleted account(s) still holding identifiers.`,
    );

    let updated = 0;
    let snapshotted = 0;
    for (const u of stale) {
      const userId = String(u._id);

      const req = await requestModel
        .findOne({ userId })
        .sort({ createdAt: -1 });
      if (req && (!req.userEmail || !req.userMobile)) {
        if (!dryRun) {
          await requestModel.updateOne(
            { _id: req._id },
            {
              $set: {
                userEmail: req.userEmail ?? u.email ?? null,
                userMobile: req.userMobile ?? u.mobileNumber ?? null,
              },
            },
          );
        }
        snapshotted++;
      }

      if (!dryRun) {
        await userModel.updateOne(
          { _id: u._id },
          {
            $unset: {
              email: '',
              mobileNumber: '',
              password: '',
              passwordResetToken: '',
              passwordResetExpiresAt: '',
            },
          },
        );
      }
      updated++;
      console.log(
        `  ${dryRun ? 'would free' : 'freed'} identifiers for user ${userId}`,
      );
    }

    console.log(
      `${dryRun ? '[dry-run] ' : ''}Done. ${updated} account(s) processed, ${snapshotted} DeleteRequest snapshot(s) backfilled.`,
    );
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
