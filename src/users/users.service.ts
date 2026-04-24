import { Injectable, ConflictException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument, UserRole } from './schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureAdminUser();
  }

  async create(createUserDto: CreateUserDto): Promise<any> {
    return this.createUser(
      {
        ...createUserDto,
        role: UserRole.USER,
      },
      UserRole.USER,
    );
  }

  private async createUser(
    createUserDto: CreateUserDto,
    defaultRole: UserRole,
  ): Promise<any> {
    const { email, password, name, role } = createUserDto;
    
    const existingUser = await this.userModel.findOne({ email });
    if (existingUser) {
      throw new ConflictException('Email already in use');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const createdUser = new this.userModel({
      name,
      email,
      password: hashedPassword,
      role: role ?? defaultRole,
    });

    const savedUser = await createdUser.save();
    
    // Return user without password
    const userObj = savedUser.toObject() as any;
    delete userObj.password;
    return userObj;
  }

  private async ensureAdminUser(): Promise<void> {
    const email = this.configService.get<string>('ADMIN_EMAIL');
    const password = this.configService.get<string>('ADMIN_PASSWORD');
    const name =
      this.configService.get<string>('ADMIN_NAME') ?? 'Laundry Admin';

    if (!email || !password) {
      return;
    }

    const existingAdmin = await this.userModel.findOne({ email });
    if (existingAdmin) {
      if (existingAdmin.role !== UserRole.ADMIN) {
        await this.userModel.findByIdAndUpdate(existingAdmin._id, {
          role: UserRole.ADMIN,
        });
      }
      return;
    }

    await this.createUser(
      {
        name,
        email,
        password,
        role: UserRole.ADMIN,
      },
      UserRole.ADMIN,
    );
  }

  async findOneByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email });
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
    const user = await this.userModel.findById(id).select('-password');
    return user;
  }
}
