import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AccountDeletionController } from './account-deletion.controller';
import { AdminAccountDeletionController } from './admin-account-deletion.controller';

import { AccountDeletionService } from './services/account-deletion.service';
import { AccountDeletionAdminService } from './services/account-deletion-admin.service';
import { AccountCleanupService } from './services/account-cleanup.service';
import { IdentityVerificationService } from './services/identity-verification.service';
import { AccountDeletionRepository } from './repositories/account-deletion.repository';
import { RateLimitGuard } from './guards/rate-limit.guard';

import {
  DeleteRequest,
  DeleteRequestSchema,
} from './schemas/delete-request.schema';
import {
  AccountAuditLog,
  AccountAuditLogSchema,
} from './schemas/account-audit-log.schema';
import { User, UserSchema } from '../users/schemas/user.schema';

import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * Account Deletion module — Google Play compliant, in-app account deletion.
 * Reuses AuthModule (JWT, token blacklist, Firebase re-auth, OTP verify) and
 * NotificationsModule (FCM token cleanup).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DeleteRequest.name, schema: DeleteRequestSchema },
      { name: AccountAuditLog.name, schema: AccountAuditLogSchema },
      { name: User.name, schema: UserSchema },
    ]),
    AuthModule,
    NotificationsModule,
  ],
  controllers: [AccountDeletionController, AdminAccountDeletionController],
  providers: [
    AccountDeletionRepository,
    AccountDeletionService,
    AccountDeletionAdminService,
    AccountCleanupService,
    IdentityVerificationService,
    RateLimitGuard,
  ],
  exports: [AccountDeletionService],
})
export class AccountDeletionModule {}
