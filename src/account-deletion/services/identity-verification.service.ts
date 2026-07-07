import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { AuthService } from '../../auth/auth.service';
import { FirebaseAdminService } from '../../auth/services/firebase-admin.service';
import { VerifyDeleteDto } from '../dto/account-deletion.dto';
import { VerificationMethod } from '../enums/account-deletion.enums';

/**
 * Verifies the identity of a user requesting account deletion.
 * Supports password, OTP, and Google/Apple (Firebase) re-authentication.
 * Single responsibility: prove the requester is the account owner.
 */
@Injectable()
export class IdentityVerificationService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly authService: AuthService,
    private readonly firebaseAdminService: FirebaseAdminService,
  ) {}

  /**
   * @returns the VerificationMethod actually used on success.
   * @throws BadRequestException when verification fails.
   */
  async verify(
    userId: string,
    dto: VerifyDeleteDto,
  ): Promise<VerificationMethod> {
    switch (dto.method) {
      case VerificationMethod.PASSWORD:
        return this.verifyPassword(userId, dto.password);
      case VerificationMethod.OTP:
        return this.verifyOtp(userId, dto.otp);
      case VerificationMethod.GOOGLE:
      case VerificationMethod.APPLE:
        return this.verifyFirebase(userId, dto.firebaseIdToken, dto.method);
      default:
        throw new BadRequestException('Unsupported verification method');
    }
  }

  private async verifyPassword(
    userId: string,
    password?: string,
  ): Promise<VerificationMethod> {
    if (!password) throw new BadRequestException('Password is required');

    const user = await this.userModel
      .findById(userId)
      .select('password')
      .lean();
    if (!user?.password) {
      throw new BadRequestException(
        'This account has no password. Use OTP verification instead.',
      );
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) throw new BadRequestException('Incorrect password');
    return VerificationMethod.PASSWORD;
  }

  private async verifyOtp(
    userId: string,
    otp?: string,
  ): Promise<VerificationMethod> {
    if (!otp) throw new BadRequestException('OTP is required');

    const user = await this.userModel
      .findById(userId)
      .select('mobileNumber')
      .lean();
    if (!user?.mobileNumber) {
      throw new BadRequestException('No mobile number on file for OTP');
    }

    const ok = this.authService.verifyOtpValue(user.mobileNumber, otp);
    if (!ok) throw new BadRequestException('Invalid or expired OTP');
    return VerificationMethod.OTP;
  }

  private async verifyFirebase(
    userId: string,
    idToken: string | undefined,
    method: VerificationMethod,
  ): Promise<VerificationMethod> {
    if (!idToken) throw new BadRequestException('Firebase ID token is required');

    const user = await this.userModel
      .findById(userId)
      .select('mobileNumber email')
      .lean();
    if (!user) throw new BadRequestException('User not found');

    const decoded = await this.firebaseAdminService.verifyIdToken(idToken);

    // Match the re-auth token to this account by phone or email.
    const tokenPhone = this.firebaseAdminService.extractPhoneNumber(decoded);
    const tokenEmail = (decoded as any).email as string | undefined;

    const phoneMatches =
      tokenPhone &&
      user.mobileNumber &&
      this.firebaseAdminService.phoneNumbersMatch(tokenPhone, user.mobileNumber);
    const emailMatches =
      tokenEmail &&
      user.email &&
      tokenEmail.toLowerCase() === user.email.toLowerCase();

    if (!phoneMatches && !emailMatches) {
      throw new BadRequestException(
        'Re-authentication did not match this account',
      );
    }
    return method;
  }
}
