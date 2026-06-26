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
    const index = addresses.findIndex((item) => item.id === addressId);
    if (index === -1) {
      throw new BadRequestException('Address not found');
    }

    const existing = addresses[index];

    const shouldBeDefault = dto.isDefault === true;
    const updated = this.buildAddress(
      {
        houseNo: dto.houseNo ?? existing.houseNo,
        buildingName: dto.buildingName ?? existing.buildingName,
        street: dto.street ?? existing.street,
        area: dto.area ?? existing.area,
        landmark: dto.landmark ?? existing.landmark,
        city: dto.city ?? existing.city,
        state: dto.state ?? existing.state,
        pincode: dto.pincode ?? existing.pincode,
        type: dto.type ?? existing.type,
        instructions: dto.instructions ?? existing.instructions,
        isDefault: shouldBeDefault ? true : existing.isDefault,
        lat: dto.lat ?? existing.lat,
        lng: dto.lng ?? existing.lng,
      },
      addressId,
      shouldBeDefault ? true : existing.isDefault,
    );

    user.addresses = addresses.map((item) => {
      if (item.id === addressId) {
        return updated;
      }

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
