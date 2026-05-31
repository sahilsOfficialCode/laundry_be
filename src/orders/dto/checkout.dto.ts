import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethod } from '../../locations/schemas/location.schema';

export enum CheckoutServiceType {
  COLLECT_FROM_HOME = 'collect_from_home',
  DROP_AT_SHOP = 'drop_at_shop',
  HOME_RECEPTION = 'home_reception',
}

export class CheckoutAddressDto {
  @IsString()
  fullAddress: string;

  @IsNumber()
  latitude: number;

  @IsNumber()
  longitude: number;

  @IsOptional()
  @IsString()
  label?: string;
}

export class ReceptionDetailsDto {
  @IsString()
  receptionName: string;

  @IsString()
  flatVillaNumber: string;

  @IsOptional()
  @IsString()
  securityInstructions?: string;

  @IsOptional()
  @IsString()
  pickupNotes?: string;
}

export class CheckoutSlotDto {
  @IsString()
  date: string;

  @IsString()
  label: string;

  @IsString()
  startTime: string;

  @IsString()
  endTime: string;
}

export class CheckoutContextDto {
  @IsEnum(CheckoutServiceType)
  serviceType: CheckoutServiceType;

  @IsOptional()
  @ValidateNested()
  @Type(() => CheckoutAddressDto)
  pickupAddress?: CheckoutAddressDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReceptionDetailsDto)
  receptionDetails?: ReceptionDetailsDto;

  @IsOptional()
  @IsString()
  selectedShopId?: string;

  @ValidateNested()
  @Type(() => CheckoutSlotDto)
  pickupSlot: CheckoutSlotDto;

  @ValidateNested()
  @Type(() => CheckoutSlotDto)
  deliverySlot: CheckoutSlotDto;

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @IsNumber()
  @Min(0)
  expectedAmount: number;
}

export class ServiceabilityQueryDto {
  @IsEnum(CheckoutServiceType)
  serviceType: CheckoutServiceType;

  @IsNumber()
  latitude: number;

  @IsNumber()
  longitude: number;

  @IsString()
  date: string;
}

export class ShopListQueryDto {
  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsString()
  date?: string;
}
