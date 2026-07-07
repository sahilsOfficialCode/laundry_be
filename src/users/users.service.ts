import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User, UserAddress, UserDocument, UserRole } from './schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UserAddressDto } from './dto/user-address.dto';
import { GetAddressesFilterDto } from './dto/get-addresses-filter.dto';
import { ServiceZonesService } from '../service-zones/service-zones.service';
import { generateReferralCode } from '../referrals/utils/referral-code.util';

/** Address types that skip service-zone coverage checks (customer can be anywhere) */
const EXEMPT_ADDRESS_TYPES = ['pickup', 'drop'];

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private readonly serviceZonesService: ServiceZonesService,
  ) {
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

  /**
   * Generate a unique, permanent referral code for a new user.
   * Uses the shared generator (crypto-random) and retries on the rare
   * collision. Kept here (using the util directly) to avoid a circular
   * dependency between UsersModule and ReferralModule.
   */
  private async generateUniqueReferralCode(): Promise<string> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = generateReferralCode();
      const exists = await this.userModel.exists({ referralCode: code });
      if (!exists) return code;
    }
    return generateReferralCode(9); // widen space on repeated collisions
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
      referralCode: await this.generateUniqueReferralCode(),
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
    const referralCode = await this.generateUniqueReferralCode();

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
            referralCode,
          },
        },
        {
          returnDocument: 'after',
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

  async findAll(): Promise<any[]> {
    return this.userModel.find().select('-password').sort({ createdAt: -1 });
  }

  async findById(id: string): Promise<any> {
    return this.userModel.findById(id).select('-password');
  }

  /**
   * Lightweight status lookup used by JwtAuthGuard on each request to enforce
   * account deletion / "logout from every device". Returns only the few fields
   * needed so it stays cheap (indexed _id lookup, lean).
   */
  async getAuthStatus(
    id: string,
  ): Promise<{
    isDeleted: boolean;
    isActive: boolean;
    sessionsValidFrom?: Date | null;
  } | null> {
    return this.userModel
      .findById(id)
      .select('isDeleted isActive sessionsValidFrom')
      .lean() as any;
  }

  async blockUser(id: string): Promise<any> {
    const user = await this.userModel
      .findByIdAndUpdate(id, { isActive: false }, { new: true })
      .select('-password');
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async unblockUser(id: string): Promise<any> {
    const user = await this.userModel
      .findByIdAndUpdate(id, { isActive: true }, { new: true })
      .select('-password');
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async changeRole(id: string, role: UserRole): Promise<any> {
    if (role === UserRole.ADMIN) {
      throw new BadRequestException('Cannot assign admin role via this endpoint');
    }
    const user = await this.userModel
      .findByIdAndUpdate(id, { role }, { new: true })
      .select('-password');
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async saveFcmToken(userId: string, token: string): Promise<void> {
    if (!token?.trim()) throw new BadRequestException('FCM token is required');
    
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    
    // Add token to fcmTokens array if not already present (multi-device support)
    if (!user.fcmTokens.includes(token.trim())) {
      user.fcmTokens.push(token.trim());
      await user.save();
    }
  }

  async updateProfile(
    userId: string,
    fields: { name?: string; photoUrl?: string },
  ): Promise<any> {
    const trimmedName  = fields.name?.trim();
    const trimmedPhoto = fields.photoUrl?.trim();

    if (!trimmedName && !trimmedPhoto) {
      throw new BadRequestException(
        'Provide at least a name or a photo URL to update.',
      );
    }

    const update: Record<string, string> = {};
    if (trimmedName)  update.name     = trimmedName;
    if (trimmedPhoto) update.photoUrl = trimmedPhoto;

    const user = await this.userModel
      .findByIdAndUpdate(userId, { $set: update }, { new: true })
      .select('-password');

    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /** @deprecated kept for backward compatibility — use updateProfile */
  async updateProfileName(userId: string, name?: string): Promise<any> {
    return this.updateProfile(userId, { name });
  }

  async getAddresses(
    userId: string,
    filter: GetAddressesFilterDto = {},
  ): Promise<{ data: UserAddress[]; total: number; page: number; limit: number }> {
    const user = await this.userModel.findById(userId).select('addresses');
    console.log('user addresses:', user?.addresses);
    if (!user) {
      throw new BadRequestException('User not found');
    }

    const all = user.addresses ?? [];
    const total = all.length;

    const page = filter.page ?? 1;
    const limit = filter.limit ?? 20;
    const start = (page - 1) * limit;
    const data = all.slice(start, start + limit);

    return { data, total, page, limit };
  }

  async addAddress(
    userId: string,
    dto: UserAddressDto,
  ): Promise<{ address: UserAddress; alreadyExists: boolean }> {
    const user = await this.userModel.findById(userId).select('addresses');
    if (!user) {
      throw new BadRequestException('User not found');
    }

    const addresses = user.addresses ?? [];

    // Duplicate check — same houseNo + street + pincode (case-insensitive trim)
    const normalize = (v?: string) => (v ?? '').trim().toLowerCase();
    const duplicate = addresses.find(
      (a) =>
        normalize(a.houseNo) === normalize(dto.houseNo) &&
        normalize(a.street) === normalize(dto.street) &&
        normalize(a.pincode) === normalize(dto.pincode),
    );

    if (duplicate) {
      return { address: duplicate, alreadyExists: true };
    }

    const shouldBeDefault = dto.isDefault === true || addresses.length === 0;
    const address = this.buildAddress(dto, crypto.randomUUID(), shouldBeDefault);

    user.addresses = shouldBeDefault
      ? [...addresses.map((item) => ({ ...item, isDefault: false })), address]
      : [...addresses, address];

    await user.save();
    return { address, alreadyExists: false };
  }

  async updateAddress(
    userId: string,
    addressId: string,
    dto: UserAddressDto,
  ): Promise<UserAddress> {
    const user = await this.userModel.findById(userId).select('addresses');
    if (!user) {
      throw new BadRequestException('User not found');
    }

    const addresses = user.addresses ?? [];

    // Support matching by either the custom UUID `id` field or Mongoose's `_id`
    const index = addresses.findIndex(
      (item) => item.id === addressId || (item as any)._id?.toString() === addressId,
    );
    if (index === -1) {
      throw new BadRequestException('Address not found');
    }

    const existing = addresses[index];
    const shouldBeDefault = dto.isDefault === true;

    // Full replacement (PUT semantics): use DTO values for all content fields.
    // Fields not sent by the client default to '' via buildAddress.
    // Only `isDefault` falls back to the existing value when not explicitly changing it.
    const updated = this.buildAddress(
      {
        ...dto,
        isDefault: shouldBeDefault ? true : existing.isDefault,
      },
      addressId,
      shouldBeDefault ? true : existing.isDefault,
    );

    user.addresses = addresses.map((item, i) => {
      if (i === index) return updated;
      return shouldBeDefault ? { ...item, isDefault: false } : item;
    });

    await user.save();
    return updated;
  }

  async deleteAddress(userId: string, addressId: string): Promise<void> {
    const user = await this.userModel.findById(userId).select('addresses');
    if (!user) {
      throw new BadRequestException('User not found');
    }

    const addresses = user.addresses ?? [];
    const removed = addresses.find((item) => item.id === addressId);
    if (!removed) {
      throw new BadRequestException('Address not found');
    }

    const remaining = addresses.filter((item) => item.id !== addressId);
    if (removed.isDefault && remaining.length > 0) {
      remaining[0] = { ...remaining[0], isDefault: true };
    }

    user.addresses = remaining;
    await user.save();
  }

  async setDefaultAddress(
    userId: string,
    addressId: string,
  ): Promise<UserAddress> {
    const user = await this.userModel.findById(userId).select('addresses');
    if (!user) {
      throw new BadRequestException('User not found');
    }

    const addresses = user.addresses ?? [];
    const selected = addresses.find((item) => item.id === addressId);
    if (!selected) {
      throw new BadRequestException('Address not found');
    }

    user.addresses = addresses.map((item) => ({
      ...item,
      isDefault: item.id === addressId,
    }));

    await user.save();
    return { ...selected, isDefault: true };
  }

  /**
   * Throws BadRequestException if the coordinates are outside every active
   * service zone. Skipped when lat/lng are absent or the address type is
   * a pickup/drop location (customer can be anywhere).
   */
  private async assertServiceCoverage(
    lat?: number,
    lng?: number,
    type?: string,
    city?: string,
  ): Promise<void> {
    if (lat == null || lng == null) return; // no coords → skip
    if (type && EXEMPT_ADDRESS_TYPES.includes(type.toLowerCase())) return; // pickup/drop → skip

    const result = await this.serviceZonesService.checkCoverage({ latitude: lat, longitude: lng, city });
    if (!result.covered) {
      throw new BadRequestException(
        'Service is not available at this location. Please add a shop address within our service area.',
      );
    }
  }

  private buildAddress(
    dto: UserAddressDto,
    id: string,
    isDefault: boolean,
  ): UserAddress {
    return {
      id,
      houseNo: dto.houseNo?.trim() ?? '',
      buildingName: dto.buildingName?.trim() ?? '',
      street: dto.street?.trim() ?? '',
      area: dto.area?.trim() ?? '',
      landmark: dto.landmark?.trim() ?? '',
      city: dto.city?.trim() ?? '',
      state: dto.state?.trim() ?? '',
      pincode: dto.pincode?.trim() ?? '',
      type: dto.type?.trim() || 'Home',
      instructions: dto.instructions?.trim() ?? '',
      isDefault,
      lat: dto.lat,
      lng: dto.lng,
    };
  }

}
