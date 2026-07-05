import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  DeleteReason,
  VerificationMethod,
} from '../enums/account-deletion.enums';

/** POST /account/delete/request — start a deletion request. */
export class RequestDeleteDto {
  @IsEnum(DeleteReason)
  reason: DeleteReason;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

/** POST /account/delete/verify — prove identity for an open request. */
export class VerifyDeleteDto {
  @IsEnum(VerificationMethod)
  method: VerificationMethod;

  /** Required when method = PASSWORD. */
  @ValidateIf((o) => o.method === VerificationMethod.PASSWORD)
  @IsString()
  @MaxLength(128)
  password?: string;

  /** Required when method = OTP. */
  @ValidateIf((o) => o.method === VerificationMethod.OTP)
  @IsString()
  @MaxLength(6)
  otp?: string;

  /** Required when method = GOOGLE/APPLE (Firebase re-auth token). */
  @ValidateIf(
    (o) =>
      o.method === VerificationMethod.GOOGLE ||
      o.method === VerificationMethod.APPLE,
  )
  @IsString()
  firebaseIdToken?: string;
}

/** POST /account/delete/confirm — final, explicit confirmation. */
export class ConfirmDeleteDto {
  /**
   * The single-use token returned by /verify.
   * Only required when REQUIRE_DELETE_VERIFICATION=true; omitted otherwise
   * because an authenticated user can confirm deletion directly.
   */
  @IsOptional()
  @IsString()
  verificationToken?: string;
}

/** POST /account/delete/send-otp — request an OTP for OTP verification. */
export class SendDeleteOtpDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  mobileNumber?: string;
}

// ── Admin ──────────────────────────────────────────────────────────────────

export class AdminDeleteActionDto {
  @IsMongoId()
  deleteRequestId: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class DeleteHistoryQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsString() format?: 'csv' | 'excel';

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 20;
}
