import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Invoice, InvoiceDocument } from './schemas/invoice.schema';
import { InvoiceCounter, InvoiceCounterDocument } from './schemas/invoice-counter.schema';
import { Order, OrderDocument } from '../orders/schemas/order.schema';
import { PricingService } from '../pricing/pricing.service';
import { UsersService } from '../users/users.service';
import { buildInvoicePdf, InvoicePdfInput } from './pdf/invoice-pdf.builder';

function formatOrderAddress(order: OrderDocument | any): string | undefined {
  const d = order.deliveryAddress;
  if (d) {
    const line = [d.houseNo, d.buildingName, d.street, d.area, d.landmark, d.city, d.state, d.pincode]
      .filter((part: any) => typeof part === 'string' && part.trim().length > 0)
      .join(', ');
    if (line) return line;
  }
  return order.address || undefined;
}

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    @InjectModel(Invoice.name) private readonly invoiceModel: Model<InvoiceDocument>,
    @InjectModel(InvoiceCounter.name) private readonly counterModel: Model<InvoiceCounterDocument>,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    private readonly pricingService: PricingService,
    private readonly usersService: UsersService,
  ) {}

  private async nextInvoiceNumber(): Promise<string> {
    const now = new Date();
    const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const counter = await this.counterModel.findOneAndUpdate(
      { _id: yyyymm },
      { $inc: { seq: 1 } },
      { upsert: true, new: true },
    );
    return `INV-${yyyymm}-${String(counter!.seq).padStart(6, '0')}`;
  }

  /**
   * Idempotent — safe to call more than once for the same order (e.g. if a
   * retried/duplicate payment-finalization call somehow reaches this again).
   * Never mints a second invoice number for the same order.
   */
  async generateForOrder(order: OrderDocument): Promise<InvoiceDocument> {
    const orderId = String(order._id);
    const existing = await this.invoiceModel.findOne({ orderId });
    if (existing) return existing;

    const snapshot = await this.pricingService.getLatestSnapshot(orderId);
    const user = await this.usersService.findById(String(order.userId));

    const itemsSnapshot =
      order.clothTypeBreakdown && order.clothTypeBreakdown.length > 0
        ? order.clothTypeBreakdown.map((c) => ({
            name: c.clothTypeName,
            quantity: c.quantity,
            rate: c.rate,
            amount: c.amount,
          }))
        : (order.items || []).map((i) => ({
            name: i.serviceName,
            quantity: i.quantity,
            rate: i.price,
            amount: i.price * i.quantity,
          }));

    const discounts: { label: string; amount: number }[] = [];
    if (order.couponDiscountAmount) {
      discounts.push({
        label: order.couponCode ? `Coupon Applied (${order.couponCode})` : 'Coupon Applied',
        amount: order.couponDiscountAmount,
      });
    }
    if (order.firstOrderDiscountAmount) {
      discounts.push({ label: 'First Order Discount Applied', amount: order.firstOrderDiscountAmount });
    }

    const lineItems =
      snapshot?.lineItems && snapshot.lineItems.length > 0
        ? snapshot.lineItems.map((l) => ({ label: l.label, amount: l.amount, kind: l.kind }))
        : [
            {
              label: 'Items Subtotal',
              amount: itemsSnapshot.reduce((s, i) => s + i.amount, 0),
              kind: 'auto' as const,
            },
          ];

    const invoiceNumber = await this.nextInvoiceNumber();

    const invoice = await this.invoiceModel.create({
      orderId,
      invoiceNumber,
      pricingSnapshotId: snapshot ? String((snapshot as any)._id) : undefined,
      orderNumber: order.orderNumber,
      customerSnapshot: { name: user?.name, phone: user?.mobileNumber, email: user?.email },
      billingAddressSnapshot: formatOrderAddress(order),
      itemsSnapshot,
      lineItems,
      taxRatePercent: order.taxAmount ? snapshot?.taxRatePercent ?? 0 : 0,
      taxAmount: order.taxAmount ?? 0,
      deliveryFee: order.deliveryFee ?? 0,
      platformFee: order.platformFee ?? 0,
      convenienceFee: order.convenienceFee ?? 0,
      packagingFee: order.packagingFee ?? 0,
      discounts,
      walletDeductionAmount: order.walletDeductionAmount ?? 0,
      payableTotal: order.billAmount ?? order.totalAmount,
      paymentMethod: 'Razorpay',
      razorpayPaymentId: order.razorpayPaymentId,
      generatedAt: new Date(),
    });

    this.logger.log(`Generated invoice ${invoiceNumber} for order ${orderId}`);
    return invoice;
  }

  async getByOrderId(orderId: string): Promise<InvoiceDocument | null> {
    return this.invoiceModel.findOne({ orderId });
  }

  async getPdfBuffer(invoice: InvoiceDocument): Promise<Buffer> {
    const input: InvoicePdfInput = {
      invoiceNumber: invoice.invoiceNumber,
      orderNumber: invoice.orderNumber,
      generatedAt: invoice.generatedAt,
      customerSnapshot: invoice.customerSnapshot,
      billingAddressSnapshot: invoice.billingAddressSnapshot,
      itemsSnapshot: invoice.itemsSnapshot,
      lineItems: invoice.lineItems,
      taxRatePercent: invoice.taxRatePercent,
      taxAmount: invoice.taxAmount,
      discounts: invoice.discounts,
      walletDeductionAmount: invoice.walletDeductionAmount,
      payableTotal: invoice.payableTotal,
      paymentMethod: invoice.paymentMethod,
      razorpayPaymentId: invoice.razorpayPaymentId,
    };
    return buildInvoicePdf(input);
  }

  /** Ownership check used by the download endpoint — throws if the order doesn't belong to this user. */
  async assertOwnership(orderId: string, userId: string): Promise<void> {
    const order = await this.orderModel.findById(orderId).select('userId').lean();
    if (!order) throw new NotFoundException('Order not found');
    if (String(order.userId) !== String(userId)) {
      throw new NotFoundException('Order not found');
    }
  }
}
