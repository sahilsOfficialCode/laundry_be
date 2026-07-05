import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SendMobileOtpDto } from './dto/send-mobile-otp.dto';
import { VerifyMobileOtpDto } from './dto/verify-mobile-otp.dto';
import { FirebaseLoginDto } from './dto/firebase-login.dto';
import { SendMobileOtpService } from './services/send-mobile-otp.service';
import { FirebaseAdminService } from './services/firebase-admin.service';

@Injectable()
export class AuthService {
  private readonly passwordResetExpiryMs = 1000 * 60 * 15;
  private readonly mobileOtpExpiryMs = 1000 * 60 * 5;
  private readonly maxOtpAttempts = 5;

  /**
   * Access-token lifetime per role, in seconds.
   * - admin: short-lived (24h) because admin accounts are high-privilege.
   * - user / delivery_partner: long-lived (~3 months) for a smooth mobile UX.
   * Values are overridable via env (JWT_TTL_ADMIN / JWT_TTL_USER /
   * JWT_TTL_DELIVERY) expressed in seconds.
   */
  private readonly tokenTtlSecondsByRole: Record<string, number>;
  private readonly defaultTtlSeconds = 24 * 60 * 60; // 24h fallback

  private readonly mobileOtpStore = new Map<
    string,
    {
      otpHash: string;
      expiresAt: number;
      attempts: number;
      isNewUser: boolean;
    }
  >();

  constructor(
    @Inject(forwardRef(() => UsersService))
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private sendMobileOtpService: SendMobileOtpService,
    private firebaseAdminService: FirebaseAdminService,
  ) {
    const DAY = 24 * 60 * 60;
    this.tokenTtlSecondsByRole = {
      admin: this.readTtlEnv('JWT_TTL_ADMIN', 1 * DAY), // 24 hours
      user: this.readTtlEnv('JWT_TTL_USER', 90 * DAY), // ~3 months
      delivery_partner: this.readTtlEnv('JWT_TTL_DELIVERY', 90 * DAY), // ~3 months
    };
  }

  /** Read a TTL (seconds) env var, coercing to a positive number or falling back. */
  private readTtlEnv(key: string, fallbackSeconds: number): number {
    const raw = this.configService.get<string>(key);
    const parsed = Number(raw);
    return raw !== undefined && Number.isFinite(parsed) && parsed > 0
      ? parsed
      : fallbackSeconds;
  }

  /** Resolve the access-token lifetime (in seconds) for a given role. */
  private getTokenTtlSeconds(role?: string): number {
    return this.tokenTtlSecondsByRole[role ?? ''] ?? this.defaultTtlSeconds;
  }

  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.usersService.findOneByEmail(email);
    if (!user?.password) {
      return null;
    }

    if (await bcrypt.compare(pass, user.password)) {
      const { password, ...result } = user.toObject();
      return result;
    }

    return null;
  }

  async login(userDto: LoginDto) {
    const user = await this.validateUser(userDto.email, userDto.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (userDto.role && user.role !== userDto.role) {
      throw new ForbiddenException(
        `This account does not have ${userDto.role} access`,
      );
    }

    return this.buildAuthResponse(user);
  }

  async sendMobileOtp(sendMobileOtpDto: SendMobileOtpDto) {
    const mobileNumber = this.firebaseAdminService.normalizePhoneNumber(
      sendMobileOtpDto.mobileNumber,
    );
    const existingUser = await this.usersService.findOneByMobile(mobileNumber);
    const isNewUser = !existingUser;

    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = this.hashValue(otp);

    this.mobileOtpStore.set(mobileNumber, {
      otpHash,
      expiresAt: Date.now() + this.mobileOtpExpiryMs,
      attempts: 0,
      isNewUser,
    });

    await this.sendMobileOtpService.sendOtp({
      mobileNumber,
      otp,
    });
    console.log(`OTP for ${mobileNumber}: ${otp} (valid for 5 minutes)`);

    return {
      success: true,
      isNewUser,
      name: existingUser?.name ?? null,
    };
  }

  async verifyMobileOtp(verifyMobileOtpDto: VerifyMobileOtpDto) {
    const mobileNumber = this.firebaseAdminService.normalizePhoneNumber(
      verifyMobileOtpDto.mobileNumber,
    );
    const record = this.mobileOtpStore.get(mobileNumber);

    if (!record) {
      throw new UnauthorizedException(
        'No OTP request found for this mobile number',
      );
    }

    if (Date.now() > record.expiresAt) {
      this.mobileOtpStore.delete(mobileNumber);
      throw new UnauthorizedException(
        'OTP has expired. Please request a new one',
      );
    }

    const receivedOtpHash = this.hashValue(verifyMobileOtpDto.otp);
    if (record.otpHash !== receivedOtpHash) {
      record.attempts += 1;
      if (record.attempts >= this.maxOtpAttempts) {
        this.mobileOtpStore.delete(mobileNumber);
        throw new UnauthorizedException(
          'Too many incorrect OTP attempts. Request a new OTP',
        );
      }

      this.mobileOtpStore.set(mobileNumber, record);
      throw new UnauthorizedException('Invalid OTP');
    }

    let user = await this.usersService.findOneByMobile(mobileNumber);

    if (record.isNewUser) {
      const name = verifyMobileOtpDto.name?.trim();
      if (!name) {
        throw new BadRequestException('Name is required');
      }

      user = await this.usersService.createMobileUser(mobileNumber, name);
    }

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    this.mobileOtpStore.delete(mobileNumber);

    const sanitizedUser = user.toObject ? user.toObject() : user;
    return {
      ...this.buildAuthResponse(sanitizedUser),
      isNewUser: record.isNewUser,
    };
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    const user = await this.usersService.findOneByEmail(
      forgotPasswordDto.email,
    );

    if (!user) {
      return {
        message:
          'If an account exists for that email, a password reset token has been generated.',
      };
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedResetToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');
    const expiresAt = new Date(Date.now() + this.passwordResetExpiryMs);

    await this.usersService.setPasswordResetToken(
      String(user._id),
      hashedResetToken,
      expiresAt,
    );

    return {
      message:
        'Password reset token generated. Connect this token to your email or reset-password screen.',
      resetToken,
      expiresAt,
    };
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const hashedResetToken = crypto
      .createHash('sha256')
      .update(resetPasswordDto.token)
      .digest('hex');

    const user =
      await this.usersService.findByPasswordResetToken(hashedResetToken);

    if (!user) {
      throw new BadRequestException('Reset token is invalid or has expired');
    }

    await this.usersService.updatePassword(
      String(user._id),
      resetPasswordDto.newPassword,
    );

    return {
      message: 'Password has been reset successfully',
    };
  }

  /**
   * Verify an OTP against the in-memory store WITHOUT logging the user in or
   * creating an account. Used by sensitive flows (e.g. account deletion) that
   * only need to confirm the user controls the phone number.
   * Reuses the same OTP that `sendMobileOtp` issues.
   */
  verifyOtpValue(mobileNumber: string, otp: string): boolean {
    const normalized =
      this.firebaseAdminService.normalizePhoneNumber(mobileNumber);
    const record = this.mobileOtpStore.get(normalized);
    if (!record) return false;

    if (Date.now() > record.expiresAt) {
      this.mobileOtpStore.delete(normalized);
      return false;
    }

    if (record.otpHash !== this.hashValue(otp)) {
      record.attempts += 1;
      if (record.attempts >= this.maxOtpAttempts) {
        this.mobileOtpStore.delete(normalized);
      }
      return false;
    }

    this.mobileOtpStore.delete(normalized);
    return true;
  }

  async verifyToken(token: string) {
    try {
      const payload = this.jwtService.verify(token);
      return { success: true, user: payload };
    } catch (e) {
      throw new ForbiddenException('Invalid or expired token');
    }
  }

  /** Short-lived cache of account status to keep the per-request check cheap. */
  private readonly accountStatusCache = new Map<
    string,
    { isDeleted: boolean; isActive: boolean; sessionsValidFrom: number; at: number }
  >();
  private readonly accountStatusTtlMs = 30_000;

  /**
   * Enforce account-level access rules on every authenticated request:
   *  - reject soft-deleted / deactivated accounts, and
   *  - reject any token issued before `sessionsValidFrom` ("logout everywhere").
   * Used by JwtAuthGuard. Cached for accountStatusTtlMs to bound DB load.
   *
   * @param tokenIatSeconds the JWT `iat` claim (seconds).
   */
  async assertAccountActive(
    userId: string,
    tokenIatSeconds?: number,
  ): Promise<void> {
    if (!userId) return;

    let status = this.accountStatusCache.get(userId);
    if (!status || Date.now() - status.at > this.accountStatusTtlMs) {
      const fresh = await this.usersService.getAuthStatus(userId);
      status = {
        isDeleted: fresh?.isDeleted ?? false,
        isActive: fresh?.isActive ?? true,
        sessionsValidFrom: fresh?.sessionsValidFrom
          ? new Date(fresh.sessionsValidFrom).getTime()
          : 0,
        at: Date.now(),
      };
      this.accountStatusCache.set(userId, status);
    }

    if (status.isDeleted || status.isActive === false) {
      throw new UnauthorizedException('This account has been deleted');
    }
    if (
      status.sessionsValidFrom > 0 &&
      tokenIatSeconds &&
      tokenIatSeconds * 1000 < status.sessionsValidFrom
    ) {
      throw new UnauthorizedException(
        'Your session has ended. Please log in again.',
      );
    }
  }

  /** Invalidate the cached status for a user (call after status changes). */
  clearAccountStatusCache(userId: string): void {
    this.accountStatusCache.delete(userId);
  }

  async firebaseLogin(firebaseLoginDto: FirebaseLoginDto) {
    const { firebaseIdToken, mobileNumber, name } = firebaseLoginDto;

    // Verify Firebase ID token
    const decodedToken = await this.firebaseAdminService.verifyIdToken(firebaseIdToken);

    // Extract phone number from Firebase token
    const firebasePhoneNumber = this.firebaseAdminService.extractPhoneNumber(decodedToken);

    if (!firebasePhoneNumber) {
      throw new UnauthorizedException('Phone number not found in Firebase token');
    }

    // Normalize both phone numbers to E.164 format
    const normalizedRequestNumber = this.firebaseAdminService.normalizePhoneNumber(mobileNumber);
    const normalizedFirebaseNumber = this.firebaseAdminService.normalizePhoneNumber(firebasePhoneNumber);

    // Verify that Firebase token phone number matches the provided mobile number
    if (!this.firebaseAdminService.phoneNumbersMatch(normalizedRequestNumber, normalizedFirebaseNumber)) {
      throw new UnauthorizedException('Phone number in Firebase token does not match provided mobile number');
    }

    // Find or create user
    let user = await this.usersService.findOneByMobile(normalizedRequestNumber);

    if (!user) {
      // New user - create account
      const userName = name?.trim();
      if (!userName) {
        throw new BadRequestException('Name is required for new users');
      }
      user = await this.usersService.createMobileUser(normalizedRequestNumber, userName);
    }

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const sanitizedUser = user.toObject ? user.toObject() : user;
    return this.buildAuthResponse(sanitizedUser);
  }

  private buildAuthResponse(user: any) {
    const userId = String(user._id ?? user.id ?? '');
    const role = user.role ?? 'user';
    const payload = {
      sub: userId,
      role,
      email: user.email,
      mobileNumber: user.mobileNumber,
    };

    const ttlSeconds = this.getTokenTtlSeconds(role);
    const token = this.jwtService.sign(payload, { expiresIn: ttlSeconds });

    return {
      success: true,
      access_token: token,
      token,
      // Lifetime info so the client (and cookie) can stay in sync with the JWT.
      expires_in: ttlSeconds, // seconds
      maxAge: ttlSeconds * 1000, // ms — convenient for res.cookie()
      user: {
        id: userId,
        email: user.email ?? '',
        mobileNumber: user.mobileNumber ?? '',
        name: user.name ?? '',
        role,
        photoUrl: user.photoUrl ?? null,
      },
    };
  }

  private hashValue(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }
}
