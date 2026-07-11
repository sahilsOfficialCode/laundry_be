/**
 * Shared enums for the Account Deletion module.
 * Single source of truth for schemas, DTOs, services and the frontend contract.
 */

/** High-level account state stored on the user document. */
export enum AccountStatus {
  ACTIVE = 'ACTIVE',
  PENDING_DELETION = 'PENDING_DELETION', // soft-deleted, within retention window
  DELETED = 'DELETED', // soft-deleted (access revoked)
  ANONYMIZED = 'ANONYMIZED', // personal data stripped by cleanup job
}

/** Lifecycle of a single delete request. */
export enum DeleteRequestStatus {
  PENDING_VERIFICATION = 'PENDING_VERIFICATION', // created, identity not yet verified
  VERIFIED = 'VERIFIED', // identity verified, awaiting final confirm
  COMPLETED = 'COMPLETED', // account soft-deleted
  CLEANED = 'CLEANED', // personal data anonymised by cleanup job
  REJECTED = 'REJECTED', // rejected/restored by admin (if policy allows)
  CANCELLED = 'CANCELLED', // user cancelled before confirming
}

/** Reason the user selected for deleting their account. */
export enum DeleteReason {
  PRIVACY_CONCERNS = 'PRIVACY_CONCERNS',
  NO_LONGER_USING = 'NO_LONGER_USING',
  CREATED_ANOTHER_ACCOUNT = 'CREATED_ANOTHER_ACCOUNT',
  TOO_EXPENSIVE = 'TOO_EXPENSIVE',
  POOR_SERVICE = 'POOR_SERVICE',
  OTHER = 'OTHER',
}

/** How the user proved their identity before deletion. */
export enum VerificationMethod {
  PASSWORD = 'PASSWORD',
  OTP = 'OTP',
  GOOGLE = 'GOOGLE', // Firebase Google/Apple re-auth
  APPLE = 'APPLE',
}

/** Audit-log action types for account_audit_logs. */
export enum AuditAction {
  DELETE_REQUESTED = 'DELETE_REQUESTED',
  IDENTITY_VERIFIED = 'IDENTITY_VERIFIED',
  DELETE_CONFIRMED = 'DELETE_CONFIRMED',
  SESSIONS_REVOKED = 'SESSIONS_REVOKED',
  DATA_ANONYMIZED = 'DATA_ANONYMIZED',
  REQUEST_REJECTED = 'REQUEST_REJECTED',
  ACCOUNT_RESTORED = 'ACCOUNT_RESTORED',
  CLEANUP_RAN = 'CLEANUP_RAN',
}
