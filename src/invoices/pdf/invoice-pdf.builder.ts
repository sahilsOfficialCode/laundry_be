import PDFDocument from 'pdfkit';

/** Plain-object shape the builder needs — deliberately not coupled to the Mongoose document type, so it stays unit-testable with a fixture. */
export interface InvoicePdfInput {
  invoiceNumber: string;
  orderNumber?: string;
  generatedAt: Date;
  customerSnapshot?: { name?: string; phone?: string; email?: string };
  billingAddressSnapshot?: string;
  itemsSnapshot: { name: string; quantity: number; rate: number; amount: number }[];
  lineItems: { label: string; amount: number; kind: 'auto' | 'manual' }[];
  taxRatePercent: number;
  taxAmount: number;
  discounts: { label: string; amount: number }[];
  walletDeductionAmount: number;
  payableTotal: number;
  paymentMethod?: string;
  razorpayPaymentId?: string;
}

const COMPANY_NAME = 'Laundrybrew';
const COMPANY_TAGLINE = 'Laundry & Dry Cleaning Services';

function formatRupees(n: number): string {
  return `Rs. ${n.toFixed(2)}`;
}

/** Pure — builds a PDF buffer from an already-fetched invoice; no DB/network access. */
export function buildInvoicePdf(invoice: InvoicePdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── Header ──────────────────────────────────────────────────────────────
    doc.fontSize(20).text(COMPANY_NAME, { continued: false });
    doc.fontSize(9).fillColor('#666').text(COMPANY_TAGLINE);
    doc.moveDown(1);

    doc.fillColor('#000').fontSize(14).text('TAX INVOICE', { align: 'right' });
    doc.fontSize(9).fillColor('#333');
    doc.text(`Invoice #: ${invoice.invoiceNumber}`, { align: 'right' });
    if (invoice.orderNumber) doc.text(`Order #: ${invoice.orderNumber}`, { align: 'right' });
    doc.text(`Date: ${invoice.generatedAt.toISOString().slice(0, 10)}`, { align: 'right' });
    doc.moveDown(1);

    // ── Customer ─────────────────────────────────────────────────────────────
    doc.fillColor('#000').fontSize(10).text('Billed To:', { underline: true });
    if (invoice.customerSnapshot?.name) doc.text(invoice.customerSnapshot.name);
    if (invoice.customerSnapshot?.phone) doc.text(invoice.customerSnapshot.phone);
    if (invoice.customerSnapshot?.email) doc.text(invoice.customerSnapshot.email);
    if (invoice.billingAddressSnapshot) doc.text(invoice.billingAddressSnapshot);
    doc.moveDown(1);

    // ── Items table ──────────────────────────────────────────────────────────
    doc.fontSize(10).text('Items', { underline: true });
    doc.moveDown(0.3);
    const colX = { name: 50, qty: 300, rate: 360, amount: 450 };
    doc.fontSize(9).fillColor('#666');
    doc.text('Description', colX.name, doc.y, { continued: false });
    doc.text('Qty', colX.qty, doc.y - 12);
    doc.text('Rate', colX.rate, doc.y - 12);
    doc.text('Amount', colX.amount, doc.y - 12);
    doc.moveDown(0.3);
    doc.fillColor('#000');
    for (const item of invoice.itemsSnapshot) {
      const y = doc.y;
      doc.text(item.name, colX.name, y, { width: 240 });
      doc.text(String(item.quantity), colX.qty, y);
      doc.text(formatRupees(item.rate), colX.rate, y);
      doc.text(formatRupees(item.amount), colX.amount, y);
    }
    doc.moveDown(1);

    // ── Pricing breakdown ────────────────────────────────────────────────────
    doc.fontSize(10).text('Billing Summary', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(9);
    for (const line of invoice.lineItems) {
      const label = line.kind === 'manual' ? `${line.label} (Admin Adjustment)` : line.label;
      doc.text(`${label}: ${formatRupees(line.amount)}`);
    }
    for (const discount of invoice.discounts) {
      doc.fillColor('#0a7a0a').text(`${discount.label}: -${formatRupees(discount.amount)}`);
    }
    if (invoice.walletDeductionAmount > 0) {
      doc.fillColor('#0a7a0a').text(`Wallet Deduction: -${formatRupees(invoice.walletDeductionAmount)}`);
    }
    doc.fillColor('#000');
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Total Payable: ${formatRupees(invoice.payableTotal)}`, { align: 'right' });
    doc.moveDown(1);

    // ── Payment info ─────────────────────────────────────────────────────────
    doc.fontSize(9).fillColor('#333');
    if (invoice.paymentMethod) doc.text(`Payment Method: ${invoice.paymentMethod}`);
    if (invoice.razorpayPaymentId) doc.text(`Transaction ID: ${invoice.razorpayPaymentId}`);
    doc.moveDown(1);

    doc.fontSize(8).fillColor('#999').text(
      'This is a system-generated invoice. Amounts shown reflect the price at the time this order was billed and do not change even if service prices change later.',
      { align: 'center' },
    );

    doc.end();
  });
}
