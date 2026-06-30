import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  Query,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  FileTypeValidator,
  MaxFileSizeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { OrdersService } from './orders.service';
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
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Query('status') status?: OrderStatus,
  ) {
    return this.ordersService.findAll(page, limit, status);
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

  /**
   * POST /orders/:orderId/washed-image
   * Admin uploads washed clothes image for an order.
   */
  @Post(':orderId/washed-image')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  async uploadWashedImage(
    @Param('orderId') orderId: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new FileTypeValidator({
            fileType: /^(image\/jpeg|image\/png|image\/webp)$/,
          }),
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
        ],
      }),
    )
    file: Express.Multer.File,
    @GetUser() user: any,
  ) {
    return this.ordersService.uploadWashedImage(orderId, file, user.sub);
  }

  /**
   * GET /orders/:orderId/washed-images
   * Admin retrieves all washed clothes images for an order.
   */
  @Get(':orderId/washed-images')
  @Roles(UserRole.ADMIN)
  async getWashedImages(@Param('orderId') orderId: string) {
    return this.ordersService.getWashedImages(orderId);
  }
}
