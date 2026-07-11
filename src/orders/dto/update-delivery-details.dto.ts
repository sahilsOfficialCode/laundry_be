import { Type } from 'class-transformer';
import { IsEnum, IsOptional, ValidateNested } from 'class-validator';

import { DeliveryType } from '../schemas/order.schema';
import { DeliveryAddressDto } from './delivery-address.dto';

/**
 * Lets the customer re-confirm or change how they'll receive their finished
 * order (self-pickup vs home-delivery) right before paying. Only allowed
 * while payment is still pending — see OrdersService.updateDeliveryDetails.
 */
export class UpdateDeliveryDetailsDto {
  @IsEnum(DeliveryType)
  deliveryType: DeliveryType;

  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveryAddressDto)
  deliveryAddress?: DeliveryAddressDto;
}
