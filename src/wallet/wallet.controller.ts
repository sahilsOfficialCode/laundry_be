import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { CreateAddMoneyOrderDto, VerifyAddMoneyDto } from './dto/add-money.dto';

@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  /**
   * GET /wallet
   * Returns current balance + last 10 transactions.
   */
  @Get()
  getWallet(@GetUser() user: any) {
    return this.walletService.getWallet(user.sub);
  }

  /**
   * GET /wallet/transactions
   * Returns all transactions for the authenticated user.
   */
  @Get('transactions')
  getAllTransactions(@GetUser() user: any) {
    return this.walletService.getAllTransactions(user.sub);
  }

  /**
   * POST /wallet/add-money/create-order
   * Creates a Razorpay order for adding money to the wallet.
   * Body: { amount: number }  — amount in INR (not paise).
   */
  @Post('add-money/create-order')
  createAddMoneyOrder(
    @GetUser() user: any,
    @Body() dto: CreateAddMoneyOrderDto,
  ) {
    return this.walletService.createAddMoneyOrder(user.sub, dto);
  }

  /**
   * POST /wallet/add-money/verify
   * Verifies Razorpay signature and credits the wallet.
   */
  @Post('add-money/verify')
  verifyAddMoney(@GetUser() user: any, @Body() dto: VerifyAddMoneyDto) {
    return this.walletService.verifyAddMoney(user.sub, dto);
  }

  /**
   * POST /wallet/pay-order/:orderId
   * Pays the bill for an existing order using the user's wallet balance.
   * Requires order to be in PROCESSING status with a confirmed billAmount.
   */
  @Post('pay-order/:orderId')
  payOrderWithWallet(
    @GetUser() user: any,
    @Param('orderId') orderId: string,
  ) {
    return this.walletService.payOrderWithWallet(user.sub, orderId);
  }
}
