/**
 * GST-ready documents rendered from frozen invoice data. Tax rates are config, and treatment is flagged for CA review.
 * PDFKit's built-in fonts lack the ₹ glyph, so PDFs print "INR".
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { Invoice } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { applyBps, formatINR, formatIST, formatTonnes } from '@agrimate/shared';
import { AuthUser } from '../auth/auth';
import { PrismaService } from '../core/core';

const inr = (v: unknown) => formatINR(String(v ?? 0), { symbol: 'INR ', alwaysPaise: true });

@Injectable()
export class InvoiceService {
  constructor(private readonly prisma: PrismaService) {}

  /** A buyer sees the buyer invoice, a farmer their statement, a partner their payout; nobody sees anyone else's. */
  private canSee(u: AuthUser, inv: Invoice, o: { buyerId: string; farmerId: string; trip: { partnerId: string | null } | null }) {
    if (u.role === 'ADMIN') return true;
    if (inv.type === 'BUYER_INVOICE') return o.buyerId === u.id;
    if (inv.type === 'FARMER_STATEMENT') return o.farmerId === u.id;
    return o.trip?.partnerId === u.id;
  }
  async listFor(u: AuthUser, orderId: string) {
    const o = await this.prisma.order.findUnique({ where: { id: orderId }, include: { invoices: true, trip: { select: { partnerId: true } } } });
    if (!o) throw new NotFoundException('Order not found');
    return o.invoices.filter((i) => this.canSee(u, i, o)).map((i) => ({ id: i.id, number: i.number, type: i.type, createdAt: i.createdAt, data: i.data }));
  }

  async renderPdf(u: AuthUser, id: string) {
    const inv = await this.prisma.invoice.findUnique({ where: { id }, include: { order: { include: { commodity: true, grade: true, buyer: true, farmer: { include: { user: true } }, trip: { select: { partnerId: true } } } } } });
    if (!inv || !this.canSee(u, inv, inv.order)) throw new NotFoundException('Invoice not found');
    const d = inv.data as Record<string, string | number>;
    const o = inv.order;
    const titles = { BUYER_INVOICE: 'Tax Invoice / Receipt', FARMER_STATEMENT: 'Settlement Statement', LOGISTICS_PAYOUT: 'Logistics Payout Statement' };
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((r) => doc.on('end', () => r(Buffer.concat(chunks))));

    doc.fontSize(18).text('Agrimate').fontSize(12).text(titles[inv.type]).moveDown();
    doc.fontSize(10).text(`Number: ${inv.number}`).text(`Date: ${formatIST(inv.createdAt)} IST`).text(`Order: ${o.code}`);
    doc.text(`Produce: ${o.commodity.name} (${o.grade.name})${o.isOrganic ? ' - Organic' : ''}, ${formatTonnes(o.quantityKg)}`);
    doc.text(`Buyer: ${o.buyer.companyName}${o.buyer.gstin ? ` (GSTIN ${o.buyer.gstin})` : ''}`).text(`Farmer: ${o.farmer.user.name}`).moveDown();
    const row = (label: string, value: string) => doc.text(`${label}: ${value}`);
    if (inv.type === 'LOGISTICS_PAYOUT') {
      row('Distance', `${d.distanceKm} km`); row('Rate per km', inr(d.ratePaisePerKm)); row('Loading fee', inr(d.loadingFeePaise)); row('Payout to partner', inr(d.baseCostPaise));
    } else {
      row('Gross value (GMV)', inr(d.gmvPaise));
      if (String(d.buyerRefundPaise) !== '0') row('Dispute refund to buyer', inr(d.buyerRefundPaise));
      if (inv.type === 'BUYER_INVOICE') row('Net payable for goods', inr(d.netGmvPaise));
      else {
        row(`Platform commission (${Number(d.commissionBps) / 100}%)`, inr(d.commissionPaise));
        row('GST on commission (informational)', inr(applyBps(BigInt(String(d.commissionPaise)), Number(d.gstOnCommissionBps ?? 0))));
        row('Inspection fee', inr(d.inspectionFeePaise));
        row('Recovered from earlier balance', inr(d.negativeOffsetPaise));
        row('Payout to bank', inr(d.farmerPayoutPaise));
      }
    }
    doc.moveDown().fontSize(8).text('Tax treatment is pending chartered-accountant review. Funds were held with an RBI-authorised payment aggregator.');
    doc.end();
    return { number: inv.number, buffer: await done };
  }
}
