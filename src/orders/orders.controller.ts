import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Query,
  HttpCode,
  HttpStatus,
  UploadedFiles,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

import { OrdersService, OrderPhotoType } from './orders.service';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrderStatus } from './schemas/order.schema';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/schemas/user.schema';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { CheckoutContextDto } from './dto/checkout-context.dto';

@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('checkout')
  async checkout(@GetUser() user: any, @Body() context: CheckoutContextDto) {
    return this.ordersService.checkout(user.sub, context);
  }

  @Get()
  @Roles(UserRole.ADMIN)
  async getAllOrders(
    @Query('page')      page:      number   = 1,
    @Query('limit')     limit:     number   = 10,
    @Query('status')    status?:   OrderStatus,
    @Query('sortField') sortField?: string,
    @Query('sortDir')   sortDir?:  'asc' | 'desc',
  ) {
    return this.ordersService.findAll(page, limit, status, sortField, sortDir);
  }

  @Get('my')
  async getMyOrders(@GetUser() user: any) {
    return this.ordersService.findMyOrders(user.sub);
  }

  /** GET /orders/my/summary — active count, completed count, cancelled count, totalSaved */
  @Get('my/summary')
  async getMyOrdersSummary(@GetUser() user: any) {
    return this.ordersService.getMyOrdersSummary(user.sub);
  }

  /**
   * GET /orders/:id  — user sees own order; admin sees any order.
   */
  @Get(':id')
  async getOrderById(@Param('id') orderId: string, @GetUser() user: any) {
    if (user?.role === UserRole.ADMIN) {
      return this.ordersService.findByIdAdmin(orderId);
    }
    return this.ordersService.findById(orderId, user.sub);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  async updateOrderStatus(
    @Param('id') orderId: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(orderId, dto);
  }

  /**
   * POST /orders/:id/photos
   * Content-Type: multipart/form-data
   * Fields:
   *   files  — up to 6 images
   *   type   — 'damage' (findings/evidence) | 'weighing' (scale/bill proof)
   *   notes  — optional JSON array of strings, aligned with files (damage only)
   */
  @Post(':id/photos')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(FilesInterceptor('files', 6, { storage: memoryStorage() }))
  async addOrderPhotos(
    @Param('id') orderId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body('type') type: string,
    @Body('notes') notesRaw?: string,
  ) {
    if (type !== 'damage' && type !== 'weighing') {
      throw new BadRequestException("type must be 'damage' or 'weighing'");
    }
    let notes: (string | undefined)[] = [];
    if (notesRaw) {
      try {
        const parsed = JSON.parse(notesRaw);
        if (Array.isArray(parsed)) notes = parsed;
      } catch {
        notes = [notesRaw]; // plain string → single note
      }
    }
    return this.ordersService.addOrderPhotos(
      orderId,
      type as OrderPhotoType,
      files,
      notes,
    );
  }

  /**
   * DELETE /orders/:id/photos/:photoId?type=damage|weighing
   */
  @Delete(':id/photos/:photoId')
  @Roles(UserRole.ADMIN)
  async removeOrderPhoto(
    @Param('id') orderId: string,
    @Param('photoId') photoId: string,
    @Query('type') type: string,
  ) {
    if (type !== 'damage' && type !== 'weighing') {
      throw new BadRequestException("type must be 'damage' or 'weighing'");
    }
    return this.ordersService.removeOrderPhoto(
      orderId,
      type as OrderPhotoType,
      photoId,
    );
  }

  /**
   * POST /orders/:id/confirm-delivery
   * User confirms delivery by entering the 4-digit OTP shown by the driver.
   */
  @Post(':id/confirm-delivery')
  @HttpCode(HttpStatus.OK)
  async confirmDelivery(
    @Param('id') orderId: string,
    @Body('otp') otp: string,
    @GetUser() user: any,
  ) {
    return this.ordersService.confirmDelivery(orderId, otp, user.sub);
  }

  /**
   * POST /orders/:id/rate
   * User rates a completed order.
   */
  @Post(':id/rate')
  @HttpCode(HttpStatus.OK)
  async rateOrder(
    @Param('id') orderId: string,
    @Body('rating') rating: number,
    @Body('comment') comment: string | undefined,
    @GetUser() user: any,
  ) {
    return this.ordersService.rateOrder(orderId, user.sub, rating, comment);
  }
}
