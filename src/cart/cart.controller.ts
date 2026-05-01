import {
  Controller,
  Post,
  Body,
  Get,
  Delete,
  Param,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';

import { CartService } from './cart.service';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { AuthService } from '../auth/auth.service';

@Controller('cart')
export class CartController {
  constructor(
    private readonly cartService: CartService,
    private readonly authService: AuthService,
  ) {}

  private async getUserFromRequest(request: Request) {
    let token = request.cookies?.access_token;

    if (!token && request.headers.authorization) {
      token = request.headers.authorization.split(' ')[1];
    }

    if (!token) {
      throw new ForbiddenException('No token provided');
    }

    const result = await this.authService.verifyToken(token);
    return result.user;
  }

  @Post('items')
  async addItem(@Req() req: Request, @Body() dto: AddToCartDto) {
    const user = await this.getUserFromRequest(req);
    return this.cartService.addItem(user.sub, dto);
  }

  @Get()
  async getCart(@Req() req: Request) {
    const user = await this.getUserFromRequest(req);
    return this.cartService.getCart(user.sub);
  }

  @Delete('items/:serviceId')
  async removeItem(@Req() req: Request, @Param('serviceId') serviceId: string) {
    const user = await this.getUserFromRequest(req);
    return this.cartService.removeItem(user.sub, serviceId);
  }
}
