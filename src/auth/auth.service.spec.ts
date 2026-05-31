import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '../users/schemas/user.schema';
import { SendMobileOtpService } from './services/send-mobile-otp.service';

describe('AuthService', () => {
  let service: AuthService;

  const usersService = {
    findOneByEmail: jest.fn(),
    findOneByMobile: jest.fn(),
    createMobileUser: jest.fn(),
    setPasswordResetToken: jest.fn(),
    findByPasswordResetToken: jest.fn(),
    updatePassword: jest.fn(),
  };

  const jwtService = {
    sign: jest.fn().mockReturnValue('signed-token'),
  };

  const sendMobileOtpService = {
    sendOtp: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: usersService,
        },
        {
          provide: JwtService,
          useValue: jwtService,
        },
        {
          provide: SendMobileOtpService,
          useValue: sendMobileOtpService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('logs in a user with valid credentials', async () => {
    const password = await bcrypt.hash('secret123', 10);
    usersService.findOneByEmail.mockResolvedValue({
      _id: 'user-id',
      email: 'test@example.com',
      name: 'Test User',
      role: UserRole.ADMIN,
      password,
      toObject: () => ({
        _id: 'user-id',
        email: 'test@example.com',
        name: 'Test User',
        role: UserRole.ADMIN,
        password,
      }),
    });

    const result = await service.login({
      email: 'test@example.com',
      password: 'secret123',
      role: UserRole.ADMIN,
    });

    expect(result).toEqual({
      access_token: 'signed-token',
      user: {
        id: 'user-id',
        email: 'test@example.com',
        mobileNumber: '',
        name: 'Test User',
        role: UserRole.ADMIN,
      },
    });
    expect(jwtService.sign).toHaveBeenCalledWith({
      email: 'test@example.com',
      sub: 'user-id',
      role: UserRole.ADMIN,
      mobileNumber: undefined,
    });
  });

  it('rejects login with invalid credentials', async () => {
    usersService.findOneByEmail.mockResolvedValue(null);

    await expect(
      service.login({
        email: 'missing@example.com',
        password: 'secret123',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects login when the requested role does not match the account role', async () => {
    const password = await bcrypt.hash('secret123', 10);
    usersService.findOneByEmail.mockResolvedValue({
      _id: 'user-id',
      email: 'test@example.com',
      name: 'Test User',
      role: UserRole.USER,
      password,
      toObject: () => ({
        _id: 'user-id',
        email: 'test@example.com',
        name: 'Test User',
        role: UserRole.USER,
        password,
      }),
    });

    await expect(
      service.login({
        email: 'test@example.com',
        password: 'secret123',
        role: UserRole.ADMIN,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('generates a reset token for an existing user', async () => {
    usersService.findOneByEmail.mockResolvedValue({
      _id: 'user-id',
      email: 'test@example.com',
    });

    const result = await service.forgotPassword({
      email: 'test@example.com',
    });

    expect(result.message).toContain('Password reset token generated');
    expect(result.resetToken).toMatch(/^[a-f0-9]{64}$/);
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(usersService.setPasswordResetToken).toHaveBeenCalledWith(
      'user-id',
      expect.any(String),
      expect.any(Date),
    );
  });

  it('does not reveal whether an email exists during forgot password', async () => {
    usersService.findOneByEmail.mockResolvedValue(null);

    const result = await service.forgotPassword({
      email: 'missing@example.com',
    });

    expect(result).toEqual({
      message:
        'If an account exists for that email, a password reset token has been generated.',
    });
    expect(usersService.setPasswordResetToken).not.toHaveBeenCalled();
  });

  it('resets the password when the token is valid', async () => {
    usersService.findByPasswordResetToken.mockResolvedValue({
      _id: 'user-id',
    });

    const result = await service.resetPassword({
      token: 'plain-reset-token',
      newPassword: 'new-secret123',
    });

    expect(result).toEqual({
      message: 'Password has been reset successfully',
    });
    expect(usersService.updatePassword).toHaveBeenCalledWith(
      'user-id',
      'new-secret123',
    );
  });

  it('rejects reset when the token is invalid or expired', async () => {
    usersService.findByPasswordResetToken.mockResolvedValue(null);

    await expect(
      service.resetPassword({
        token: 'bad-token',
        newPassword: 'new-secret123',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
