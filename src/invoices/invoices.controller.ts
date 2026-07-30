import { Controller, Get, Param, NotFoundException, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { InvoicesService } from './invoices.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserRole } from '../users/schemas/user.schema';
import { InvoiceDownloadRateLimitGuard } from './guards/invoice-download-rate-limit.guard';

/**
 * JwtAuthGuard is already global (see app.module.ts); every route here still
 * enforces an explicit ownership check for non-admin callers rather than
 * relying on role alone — an authenticated user must never be able to reach
 * another user's invoice by guessing/enumerating an orderId.
 */
@Controller('invoices')
@UseGuards(JwtAuthGuard)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  /** GET /invoices/order/:orderId — lightweight metadata used by both frontends to decide whether to show "Download Invoice". */
  @Get('order/:orderId')
  async getMetadata(@Param('orderId') orderId: string, @GetUser() user: any) {
    if (user?.role !== UserRole.ADMIN) {
      await this.invoicesService.assertOwnership(orderId, user.sub);
    }
    const invoice = await this.invoicesService.getByOrderId(orderId);
    if (!invoice) {
      throw new NotFoundException('Invoice not available for this order yet');
    }
    return {
      invoiceNumber: invoice.invoiceNumber,
      generatedAt: invoice.generatedAt,
      payableTotal: invoice.payableTotal,
    };
  }

  /** GET /invoices/order/:orderId/download — streams the PDF. */
  @Get('order/:orderId/download')
  @UseGuards(InvoiceDownloadRateLimitGuard)
  async download(@Param('orderId') orderId: string, @GetUser() user: any, @Res() res: Response) {
    if (user?.role !== UserRole.ADMIN) {
      await this.invoicesService.assertOwnership(orderId, user.sub);
    }
    const invoice = await this.invoicesService.getByOrderId(orderId);
    if (!invoice) {
      throw new NotFoundException('Invoice not available for this order yet');
    }
    const pdf = await this.invoicesService.getPdfBuffer(invoice);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${invoice.invoiceNumber}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.send(pdf);
  }
}
