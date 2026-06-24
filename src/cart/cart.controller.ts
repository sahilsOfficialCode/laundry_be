import {
  Controller,
  Post,
  Body,
  Get,
  Delete,
  Param,
} from '@nestjs/common';
import { CartService } from './cart.service';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { GetUser } from '../auth/decorators/get-user.decorator';

@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Post('items')
  async addItem(@GetUser() user: any, @Body() dto: AddToCartDto) {
    return this.cartService.addItem(user.sub, dto);
  }

  @Get()
  async getCart(@GetUser() user: any) {
    return this.cartService.getCart(user.sub);
  }

  @Delete('items/:serviceId')
  async removeItem(@GetUser() user: any, @Param('serviceId') serviceId: string) {
    return this.cartService.removeItem(user.sub, serviceId);
  }
}
