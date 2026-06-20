import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User, UserDocument, UserRole } from './schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {
    this.seedAdmin();
  }

  private async seedAdmin() {
    const adminCount = await this.userModel.countDocuments({
      role: UserRole.ADMIN,
    });
    if (adminCount === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await this.userModel.create({
        name: 'Super Admin',
        email: 'admin@example.com',
        password: hashedPassword,
        role: UserRole.ADMIN,
        isActive: true,
      });
      console.log('Default admin user created: admin@example.com / admin123');
    }
  }

  async create(createUserDto: CreateUserDto): Promise<any> {
    return this.createUser(createUserDto);
  }

  private async createUser(createUserDto: CreateUserDto): Promise<any> {
    const { email, password, name } = createUserDto;

    const existingUser = await this.userModel.findOne({ email });
    if (existingUser) {
      throw new ConflictException('Email already in use');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const createdUser = new this.userModel({
      name,
      email,
      password: hashedPassword,
      role: UserRole.USER,
    });

    const savedUser = await createdUser.save();

    // Return user without password
    const userObj = savedUser.toObject() as any;
    delete userObj.password;
    return userObj;
  }

  async findOneByEmail(email: string): Promise<UserDocument | null> {
    if (!email.trim()) {
      return null;
    }

    return this.userModel.findOne({ email });
  }

  async findOneByMobile(mobileNumber: string): Promise<UserDocument | null> {
    if (!mobileNumber.trim()) {
      return null;
    }

    return this.userModel.findOne({ mobileNumber });
  }

  async createMobileUser(
    mobileNumber: string,
    name?: string,
  ): Promise<UserDocument> {
    const existingUser = await this.findOneByMobile(mobileNumber);
    if (existingUser) {
      return existingUser;
    }

    const randomPassword = crypto.randomBytes(16).toString('hex');
    const hashedPassword = await bcrypt.hash(randomPassword, 10);
    const userName = name?.trim() ? name.trim() : 'Laundry Customer';

    try {
      const user = await this.userModel.findOneAndUpdate(
        { mobileNumber },
        {
          $setOnInsert: {
            name: userName,
            mobileNumber,
            password: hashedPassword,
            role: UserRole.USER,
            isActive: true,
          },
        },
        {
          new: true,
          upsert: true,
          setDefaultsOnInsert: true,
        },
      );
      if (user) {
        return user;
      }
    } catch (error) {
      const user = await this.findOneByMobile(mobileNumber);
      if (user) {
        return user;
      }
    }

    throw new ConflictException(
      'Unable to create user with this mobile number',
    );
  }

  async setPasswordResetToken(
    userId: string,
    passwordResetToken: string,
    passwordResetExpiresAt: Date,
  ): Promise<void> {
    await this.userModel.findByIdAndUpdate(userId, {
      passwordResetToken,
      passwordResetExpiresAt,
    });
  }

  async findByPasswordResetToken(
    passwordResetToken: string,
  ): Promise<UserDocument | null> {
    return this.userModel.findOne({
      passwordResetToken,
      passwordResetExpiresAt: { $gt: new Date() },
    });
  }

  async updatePassword(userId: string, password: string): Promise<void> {
    const hashedPassword = await bcrypt.hash(password, 10);
    await this.userModel.findByIdAndUpdate(userId, {
      password: hashedPassword,
      $unset: {
        passwordResetToken: 1,
        passwordResetExpiresAt: 1,
      },
    });
  }

  async findById(id: string): Promise<any> {
    return this.userModel.findById(id).select('-password');
  }

  async updateProfileName(userId: string, name?: string): Promise<any> {
    const trimmedName = name?.trim();
    if (!trimmedName) {
      throw new BadRequestException('Name is required');
    }

    return this.userModel
      .findByIdAndUpdate(
        userId,
        { name: trimmedName },
        {
          new: true,
        },
      )
      .select('-password');
  }

  async findAll(): Promise<any[]> {
    return this.userModel.find().select('-password').sort({ createdAt: -1 });
  }

  async blockUser(id: string): Promise<any> {
    return this.userModel
      .findByIdAndUpdate(id, { isActive: false }, { new: true })
      .select('-password');
  }

  async unblockUser(id: string): Promise<any> {
    return this.userModel
      .findByIdAndUpdate(id, { isActive: true }, { new: true })
      .select('-password');
  }
}
