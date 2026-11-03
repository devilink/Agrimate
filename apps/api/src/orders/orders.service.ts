/** Order creation at MATCHED, ownership checks, role-scoped views (phones masked until unlocked), RFQ and catalog flows. */
import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { FarmerProfile, Prisma } from '@prisma/client';
import { computeSettlement, gmvPaise, inspectionFee, maskPhone, phonesUnlocked, splitTranches, OrderState, BidPriceRule } from '@agrimate/shared';
import { AuthUser } from '../auth/auth';
import { Clock, ConfigService, CryptoService, PrismaService, Tx } from '../core/core';
import { LedgerService, NotificationsService, OrderEngine } from '../engine/engine';
import { AcceptListingDto, CreateBidDto, CreateListingDto, CreateRfqDto } from './orders.dto';

const ORDER_INCLUDE = {
  commodity: true, grade: true, tranches: true, virtualAccount: true, inspection: true, selfCert: true, trip: { include: { vehicle: true } }, disputes: true, spotTests: true, invoices: { select: { id: true, number: true, type: true, createdAt: true } }, dispatchPhotos: true, contractTerms: { select: { version: true, body: true } },
  buyer: { include: { user: true } }, farmer: { include: { user: true } },
} satisfies Prisma.OrderInclude;
export type FullOrder = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

const code = (prefix: string, id: string) => `${prefix}-${id.slice(-8).toUpperCase()}`;
const newCode = (prefix: string, c: CryptoService) => code(prefix, c.randomToken(9).replace(/[-_]/g, 'X'));

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService, private readonly crypto: CryptoService, private readonly clock: Clock, private readonly config: ConfigService, private readonly engine: OrderEngine, private readonly ledger: LedgerService, private readonly notifications: NotificationsService) {}

  // ---- Access --------------------------------------------------------------------------------------------------
  async getFull(id: string) {
    const o = await this.prisma.order.findUnique({ where: { id }, include: ORDER_INCLUDE });
    if (!o) throw new NotFoundException('Order not found');
    return o;
  }
  /** Row-level ownership. A stranger gets 404, so that order ids cannot be probed. */
  assertAccess(u: AuthUser, o: { buyerId: string; farmerId: string; inspection?: { inspectorId: string | null } | null; trip?: { partnerId: string | null; status?: string; fundedAt?: Date | null } | null }) {
    if (u.role === 'ADMIN') return;
    if (u.role === 'BUYER' && o.buyerId === u.id) return;
    if (u.role === 'FARMER' && o.farmerId === u.id) return;
    if (u.role === 'INSPECTOR' && o.inspection?.inspectorId === u.id) return;
    if (u.role === 'LOGISTICS' && o.trip?.partnerId === u.id) return;
    throw new NotFoundException('Order not found');
  }
  async view(u: AuthUser, id: string) {
    const o = await this.getFull(id);
    this.assertAccess(u, o);
    return this.toView(o, u);
  }

  private phone(state: string, user: { phoneEnc: string; phoneLast4: string }) {
    const unlocked = phonesUnlocked(state as OrderState);
    return { phone: unlocked ? this.crypto.decrypt(user.phoneEnc) : maskPhone(`+91000000${user.phoneLast4}`), phoneUnlocked: unlocked };
  }

  /** Each role sees what it needs and nothing else: an inspector or driver never sees the commercial terms. */
  async toView(o: FullOrder, u: AuthUser) {
    const base = {
      id: o.id, code: o.code, flow: o.flow, state: o.state, isOrganic: o.isOrganic, quantityKg: o.quantityKg, createdAt: o.createdAt,
      commodity: { id: o.commodity.id, code: o.commodity.code, name: o.commodity.name, names: o.commodity.names }, grade: { id: o.grade.id, code: o.grade.code, name: o.grade.name, parameters: o.grade.parameters },
      pickupPin: o.pickupPin, pickupLat: o.pickupLat, pickupLng: o.pickupLng, deliveryPin: o.deliveryPin, t0At: o.t0At, slaDays: o.slaDays, slaDeadlineAt: o.slaDeadlineAt, inspectionDayAt: o.inspectionDayAt, logisticsMode: o.logisticsMode, selfCertRequired: o.selfCertRequired,
      dispatchedWeightKg: o.dispatchedWeightKg, receivedWeightKg: o.receivedWeightKg, deliveredAt: o.deliveredAt, disputeDeadlineAt: o.disputeDeadlineAt, settledAt: o.settledAt,
      inspection: o.inspection ? { id: o.inspection.id, status: o.inspection.status, scheduledFor: o.inspection.scheduledFor, inspectorId: o.inspection.inspectorId, checkInAt: o.inspection.checkInAt, readings: o.inspection.readings, gradeCheck: o.inspection.gradeCheck, scaleWeightKg: o.inspection.scaleWeightKg, inspectedAt: o.inspection.inspectedAt, photoFileIds: o.inspection.photoFileIds, deviationAcceptedAt: o.inspection.deviationAcceptedAt } : null,
      selfCert: o.selfCert ? { submittedAt: o.selfCert.submittedAt, certifiedWeightKg: o.selfCert.certifiedWeightKg, scaleVideoFileId: o.selfCert.scaleVideoFileId, vehicleVideoFileId: o.selfCert.vehicleVideoFileId, scaleCapture: o.selfCert.scaleCapture, vehicleCapture: o.selfCert.vehicleCapture } : null,
      selfCertifiedBadge: !!o.selfCert?.submittedAt,
    };
    const tripBase = o.trip ? { id: o.trip.id, status: o.trip.status, vehicleRegNo: o.trip.vehicle?.regNo ?? null, tierCode: o.trip.tierCode, distanceKm: o.trip.distanceMetres / 1000, ewayBillNumber: o.trip.ewayBillNumber, noCoLoadingAttestedAt: o.trip.noCoLoadingAttestedAt, pickedUpAt: o.trip.pickedUpAt, deliveredAt: o.trip.deliveredAt, podPhotoFileId: o.trip.podPhotoFileId, ewayBillFileId: o.trip.ewayBillFileId, fundedAt: o.trip.fundedAt } : null;
    const parties = {
      buyer: { id: o.buyerId, name: o.buyer.companyName, ...this.phone(o.state, o.buyer.user) },
      farmer: { id: o.farmerId, name: o.farmer.user.name, district: o.farmer.district, state: o.farmer.state, ...this.phone(o.state, o.farmer.user) },
    };
    const money = {
      pricePaisePerKg: o.pricePaisePerKg, gmvPaise: o.gmvPaise, advanceBps: o.advanceBps, commissionBps: o.commissionBps, inspectionFeePaise: o.inspectionFeePaise, inspectionFeePayer: o.inspectionFeePayer, buyerRefundPaise: o.buyerRefundPaise,
      tranches: o.tranches.map((t) => ({ kind: t.kind, expectedPaise: t.expectedPaise, receivedPaise: t.receivedPaise, status: t.status, paidAt: t.paidAt })),
      invoices: o.invoices, contract: { version: o.contractTerms.version, acceptedAt: o.contractAcceptedAt, body: o.contractTerms.body },
      disputes: o.disputes, spotTests: o.spotTests,
    };
    const freight = o.trip ? { distanceKm: o.trip.distanceMetres / 1000, ratePaisePerKm: o.trip.ratePaisePerKm, loadingFeePaise: o.trip.loadingFeePaise, baseCostPaise: o.trip.baseCostPaise, markupPaise: o.trip.markupPaise, finalFreightPaise: o.trip.finalFreightPaise, displayPtkmPaise: o.trip.displayPtkmPaise } : null;
    if (u.role === 'BUYER' || u.role === 'ADMIN') {
      const va = o.virtualAccount ? { ifsc: o.virtualAccount.ifsc, accountNumber: o.virtualAccount.accountNumber, beneficiary: o.virtualAccount.beneficiary, closedAt: o.virtualAccount.closedAt } : null;
      const external = o.logisticsMode === 'EXTERNAL' ? { vehicleNo: o.externalVehicleNo, driverPhone: o.externalDriverPhoneEnc ? this.crypto.decrypt(o.externalDriverPhoneEnc) : null } : null;
      const escrowPaise = await this.ledger.escrowBalance(o.id);
      return { ...base, ...parties, ...money, virtualAccount: va, trip: tripBase, freight, external, escrowPaise, ...(u.role === 'ADMIN' ? { payouts: await this.prisma.payout.findMany({ where: { orderId: o.id } }), events: await this.events(o.id) } : {}) };
    }
    if (u.role === 'FARMER') {
      const outstanding = await this.ledger.farmerOwes(o.farmerId);
      const fromFarmer = o.inspectionFeePayer === 'FARMER';
      const preview = computeSettlement({ gmv: o.gmvPaise, commissionBps: o.commissionBps, inspectionFee: o.inspection?.status === 'WAIVED_SELF_CERT' ? 0n : o.inspectionFeePaise, inspectionFeeFromFarmer: fromFarmer, outstandingNegative: outstanding < 0n ? 0n : outstanding, buyerRefund: o.buyerRefundPaise });
      return { ...base, ...parties, ...money, trip: tripBase, settlementPreview: preview, dispatchPhotos: o.dispatchPhotos };
    }
    const farmerContact = { farmer: parties.farmer };
    if (u.role === 'INSPECTOR') return { ...base, ...farmerContact };
    return { ...base, ...farmerContact, buyer: parties.buyer, trip: tripBase, payoutPaise: o.trip?.baseCostPaise ?? null };
  }

  events(orderId: string) { return this.prisma.orderEvent.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } }); }

  async listMine(u: AuthUser, state?: string) {
    const where: Prisma.OrderWhereInput = { ...(u.role === 'BUYER' ? { buyerId: u.id } : u.role === 'FARMER' ? { farmerId: u.id } : u.role === 'INSPECTOR' ? { inspection: { inspectorId: u.id } } : u.role === 'LOGISTICS' ? { trip: { partnerId: u.id } } : {}), ...(state ? { state: state as OrderState } : {}) };
    const orders = await this.prisma.order.findMany({ where, include: { commodity: true, grade: true, tranches: true }, orderBy: { createdAt: 'desc' }, take: 200 });
    const commercial = u.role === 'BUYER' || u.role === 'FARMER' || u.role === 'ADMIN';
    return orders.map((o) => ({ id: o.id, code: o.code, flow: o.flow, state: o.state, commodity: o.commodity.name, grade: o.grade.name, isOrganic: o.isOrganic, quantityKg: o.quantityKg, slaDeadlineAt: o.slaDeadlineAt, createdAt: o.createdAt, ...(commercial ? { gmvPaise: o.gmvPaise, tranches: o.tranches.map((t) => ({ kind: t.kind, status: t.status, expectedPaise: t.expectedPaise, receivedPaise: t.receivedPaise })) } : {}) }));
  }

  // ---- Order creation -------------------------------------------------------------------------------------------
  private async createOrder(tx: Tx, i: { flow: 'RFQ' | 'CATALOG'; buyerId: string; farmer: FarmerProfile; commodityId: string; gradeId: string; quantityKg: number; pricePaisePerKg: bigint; pickupPin: string; deliveryPin: string; neededBy?: Date; rfqId?: string; listingId?: string; isOrganic: boolean; actorId: string }) {
    if (i.farmer.lat == null || i.farmer.lng == null) throw new ConflictException({ code: 'FARMER_LOCATION_MISSING', message: 'The farmer has no pickup location on file' });
    const terms = await tx.contractTerms.findFirst({ where: { active: true } });
    if (!terms) throw new ConflictException({ code: 'NO_CONTRACT_TERMS', message: 'No active contract terms' });
    const [advanceBps, commissionBps, freightMarkupBps, disputeWindowHours, payer, tiers] = await Promise.all([
      this.config.get('advanceBps', tx), this.config.get('commissionBps', tx), this.config.get('freightMarkupBps', tx), this.config.get('disputeWindowHours', tx), this.config.get('inspectionFeePayer', tx), tx.inspectionFeeTier.findMany(),
    ]);
    const slaDays = await this.config.get(i.flow === 'RFQ' ? 'rfqSlaDays' : 'catalogSlaDays', tx);
    const gmv = gmvPaise(i.quantityKg, i.pricePaisePerKg);
    const fee = inspectionFee(i.quantityKg, tiers);
    const { advance, balance } = splitTranches(gmv, advanceBps);
    const order = await tx.order.create({
      data: {
        code: newCode('AGR', this.crypto), flow: i.flow, state: 'MATCHED', buyerId: i.buyerId, farmerId: i.farmer.userId, rfqId: i.rfqId, listingId: i.listingId, commodityId: i.commodityId, gradeId: i.gradeId, isOrganic: i.isOrganic,
        quantityKg: i.quantityKg, pricePaisePerKg: i.pricePaisePerKg, gmvPaise: gmv, advanceBps, commissionBps, freightMarkupBps, inspectionFeePaise: fee, inspectionFeePayer: payer, slaDays, disputeWindowHours,
        pickupPin: i.pickupPin, pickupLat: i.farmer.lat, pickupLng: i.farmer.lng, deliveryPin: i.deliveryPin, neededBy: i.neededBy, contractTermsId: terms.id, contractAcceptedAt: this.clock.now(),
        tranches: { create: [{ kind: 'ADVANCE', expectedPaise: advance }, { kind: 'BALANCE', expectedPaise: payer === 'BUYER' ? balance + fee : balance }] },
      },
    });
    await tx.orderEvent.create({ data: { orderId: order.id, actorId: i.actorId, actorRole: 'BUYER', from: null, to: 'MATCHED', payload: { contractVersion: terms.version, flow: i.flow } } });
    return this.engine.advance(tx, order.id);
  }

  // ---- RFQ flow -------------------------------------------------------------------------------------------------
  private async requireKybVerified(buyerId: string) {
    const b = await this.prisma.buyerProfile.findUniqueOrThrow({ where: { userId: buyerId } });
    if (b.kybStatus !== 'VERIFIED') throw new ForbiddenException({ code: 'KYB_REQUIRED', message: 'Complete business verification first' });
  }
  /** Farmers under manual review may trade, but their payouts stay blocked until it clears. */
  private async requireKycTradable(farmerId: string) {
    const f = await this.prisma.farmerProfile.findUniqueOrThrow({ where: { userId: farmerId } });
    if (f.kycStatus !== 'VERIFIED' && f.kycStatus !== 'MANUAL_REVIEW') throw new ForbiddenException({ code: 'KYC_REQUIRED', message: 'Complete KYC first' });
    return f;
  }
  private async requireGrade(commodityId: string, gradeId: string) {
    const g = await this.prisma.grade.findFirst({ where: { id: gradeId, commodityId, active: true } });
    if (!g) throw new UnprocessableEntityException({ code: 'GRADE_INVALID', message: 'That grade does not belong to that commodity' });
    return g;
  }

  async createRfq(u: AuthUser, d: CreateRfqDto, suggested: bigint | null) {
    await this.requireKybVerified(u.id);
    await this.requireGrade(d.commodityId, d.gradeId);
    return this.prisma.rfq.create({ data: { code: newCode('RFQ', this.crypto), buyerId: u.id, commodityId: d.commodityId, gradeId: d.gradeId, quantityKg: d.quantityKg, deliveryPin: d.deliveryPin, neededBy: new Date(d.neededBy), targetPricePaisePerKg: BigInt(d.targetPricePaisePerKg), suggestedPricePaisePerKg: suggested, organicRequired: d.organicRequired ?? false } });
  }

  async listRfqs(u: AuthUser) {
    const where: Prisma.RfqWhereInput = u.role === 'BUYER' ? { buyerId: u.id } : u.role === 'ADMIN' ? {} : { state: { in: ['RFQ_OPEN', 'BIDDING'] } };
    const rows = await this.prisma.rfq.findMany({ where, include: { commodity: true, grade: true, buyer: { select: { companyName: true, user: { select: { phoneLast4: true } } } }, bids: u.role === 'FARMER' ? { where: { farmerId: u.id } } : { select: { id: true } }, order: { select: { id: true, code: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
    return rows.map(({ buyer, ...r }) => ({ ...r, buyerName: buyer.companyName, buyerPhoneMasked: maskPhone(`+91000000${buyer.user.phoneLast4}`), bidCount: r.bids.length, myBid: u.role === 'FARMER' ? (r.bids[0] ?? null) : undefined, bids: undefined }));
  }

  async submitBid(u: AuthUser, rfqId: string, d: CreateBidDto) {
    const farmer = await this.requireKycTradable(u.id);
    const price = BigInt(d.pricePaisePerKg);
    return this.prisma.tx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Rfq" WHERE id = ${rfqId} FOR UPDATE`;
      const rfq = await tx.rfq.findUnique({ where: { id: rfqId } });
      if (!rfq) throw new NotFoundException('RFQ not found');
      if (rfq.state !== 'RFQ_OPEN' && rfq.state !== 'BIDDING') throw new ConflictException({ code: 'ILLEGAL_TRANSITION', message: 'This RFQ is closed' });
      // v1: one bid fills one RFQ, so the bid must cover the whole volume.
      if (d.quantityKg !== rfq.quantityKg) throw new UnprocessableEntityException({ code: 'BID_QUANTITY', message: `Bid must be for the full ${rfq.quantityKg} kg` });
      const rule = (await this.config.get('bidPriceRule', tx)) as BidPriceRule;
      const ok = rule === 'EQ_TARGET' ? price === rfq.targetPricePaisePerKg : price <= rfq.targetPricePaisePerKg;
      if (!ok || price <= 0n) throw new UnprocessableEntityException({ code: 'BID_PRICE', message: rule === 'EQ_TARGET' ? 'Bid must equal the target price' : 'Bid cannot exceed the target price' });
      if (rfq.organicRequired && !(await this.validOrganicCert(tx, u.id))) throw new UnprocessableEntityException({ code: 'ORGANIC_REQUIRED', message: 'This RFQ needs a verified, unexpired organic certificate' });
      if (farmer.lat == null) throw new ConflictException({ code: 'FARMER_LOCATION_MISSING', message: 'Add your farm location first' });
      const bid = await tx.bid.upsert({ where: { rfqId_farmerId: { rfqId, farmerId: u.id } }, create: { rfqId, farmerId: u.id, quantityKg: d.quantityKg, pricePaisePerKg: price }, update: { quantityKg: d.quantityKg, pricePaisePerKg: price, state: 'SUBMITTED' } });
      if (rfq.state === 'RFQ_OPEN') await tx.rfq.update({ where: { id: rfqId }, data: { state: 'BIDDING' } });
      return bid;
    });
  }

  /** Bids inbox. Farmer phones are masked here: they only unlock on the order, after a bid is accepted. */
  async listBids(u: AuthUser, rfqId: string) {
    const rfq = await this.prisma.rfq.findUnique({ where: { id: rfqId } });
    if (!rfq || (u.role !== 'ADMIN' && rfq.buyerId !== u.id)) throw new NotFoundException('RFQ not found');
    const bids = await this.prisma.bid.findMany({ where: { rfqId }, include: { farmer: { include: { user: { select: { name: true, phoneLast4: true } } } } }, orderBy: { pricePaisePerKg: 'asc' } });
    return bids.map((b) => ({ id: b.id, rfqId: b.rfqId, state: b.state, quantityKg: b.quantityKg, pricePaisePerKg: b.pricePaisePerKg, createdAt: b.createdAt, farmer: { id: b.farmerId, name: b.farmer.user.name, type: b.farmer.type, fpoName: b.farmer.fpoName, district: b.farmer.district, state: b.farmer.state, phoneMasked: maskPhone(`+91000000${b.farmer.user.phoneLast4}`) } }));
  }

  async acceptBid(u: AuthUser, bidId: string, acceptContract: boolean) {
    if (!acceptContract) throw new UnprocessableEntityException({ code: 'CONTRACT_NOT_ACCEPTED', message: 'You must accept the contract terms' });
    await this.requireKybVerified(u.id);
    const id = await this.prisma.tx(async (tx) => {
      const bid0 = await tx.bid.findUnique({ where: { id: bidId } });
      if (!bid0) throw new NotFoundException('Bid not found');
      await tx.$queryRaw`SELECT id FROM "Rfq" WHERE id = ${bid0.rfqId} FOR UPDATE`;
      const bid = await tx.bid.findUniqueOrThrow({ where: { id: bidId }, include: { rfq: true, farmer: true } });
      if (bid.rfq.buyerId !== u.id) throw new NotFoundException('Bid not found');
      if (bid.state !== 'SUBMITTED' || bid.rfq.state !== 'BIDDING') throw new ConflictException({ code: 'ILLEGAL_TRANSITION', message: 'This bid can no longer be accepted' });
      await tx.bid.update({ where: { id: bidId }, data: { state: 'ACCEPTED' } });
      await tx.bid.updateMany({ where: { rfqId: bid.rfqId, id: { not: bidId } }, data: { state: 'REJECTED' } });
      await tx.rfq.update({ where: { id: bid.rfqId }, data: { state: 'MATCHED' } });
      const organic = bid.rfq.organicRequired && !!(await this.validOrganicCert(tx, bid.farmerId));
      const o = await this.createOrder(tx, { flow: 'RFQ', buyerId: u.id, farmer: bid.farmer, commodityId: bid.rfq.commodityId, gradeId: bid.rfq.gradeId, quantityKg: bid.quantityKg, pricePaisePerKg: bid.pricePaisePerKg, pickupPin: bid.farmer.pin ?? bid.rfq.deliveryPin, deliveryPin: bid.rfq.deliveryPin, neededBy: bid.rfq.neededBy, rfqId: bid.rfqId, isOrganic: organic, actorId: u.id });
      return o.id;
    });
    return this.view(u, id);
  }

  async cancelRfq(u: AuthUser, id: string) {
    const r = await this.prisma.rfq.findUnique({ where: { id } });
    if (!r || r.buyerId !== u.id) throw new NotFoundException('RFQ not found');
    const done = await this.prisma.rfq.updateMany({ where: { id, state: { in: ['RFQ_OPEN', 'BIDDING'] } }, data: { state: 'CANCELLED' } });
    if (!done.count) throw new ConflictException({ code: 'ILLEGAL_TRANSITION', message: 'This RFQ can no longer be cancelled' });
    return { cancelled: true };
  }

  // ---- Catalog flow ---------------------------------------------------------------------------------------------
  /** The only thing that can make produce "organic": a verified certificate that has not expired. */
  validOrganicCert(db: Tx | PrismaService, farmerId: string, certId?: string) {
    return db.organicCertificate.findFirst({ where: { farmerId, status: 'VERIFIED', expiresAt: { gt: this.clock.now() }, ...(certId ? { id: certId } : {}) } });
  }

  async createListing(u: AuthUser, d: CreateListingDto) {
    const farmer = await this.requireKycTradable(u.id);
    await this.requireGrade(d.commodityId, d.gradeId);
    if (d.organicCertId && !(await this.validOrganicCert(this.prisma, u.id, d.organicCertId))) throw new UnprocessableEntityException({ code: 'ORGANIC_CERT_INVALID', message: 'Organic needs a verified, unexpired certificate' });
    const pickupPin = d.pickupPin ?? farmer.pin;
    if (!pickupPin) throw new ConflictException({ code: 'FARMER_LOCATION_MISSING', message: 'Add your farm location first' });
    if (BigInt(d.pricePaisePerKg) <= 0n) throw new UnprocessableEntityException({ code: 'PRICE_INVALID', message: 'Price must be above zero' });
    return this.prisma.listing.create({ data: { code: newCode('LST', this.crypto), farmerId: u.id, commodityId: d.commodityId, gradeId: d.gradeId, quantityKg: d.quantityKg, pricePaisePerKg: BigInt(d.pricePaisePerKg), pickupPin, organicCertId: d.organicCertId } });
  }

  async browseListings(u: AuthUser, f: { commodityId?: string; gradeId?: string; organic?: string; state?: string; minKg?: string; maxKg?: string; mine?: string }) {
    const now = this.clock.now();
    const organic = f.organic === 'true';
    const mine = f.mine === 'true' && u.role === 'FARMER';
    const where: Prisma.ListingWhereInput = {
      ...(mine ? { farmerId: u.id } : { state: 'LISTED' }), commodityId: f.commodityId, gradeId: f.gradeId,
      ...(organic ? { organicCert: { status: 'VERIFIED', expiresAt: { gt: now } } } : {}), ...(f.state ? { farmer: { state: f.state } } : {}),
      quantityKg: { ...(f.minKg ? { gte: Number(f.minKg) } : {}), ...(f.maxKg ? { lte: Number(f.maxKg) } : {}) },
    };
    const rows = await this.prisma.listing.findMany({ where, include: { commodity: true, grade: true, organicCert: true, farmer: { include: { user: { select: { name: true, phoneLast4: true } } } } }, orderBy: { createdAt: 'desc' }, take: 200 });
    return rows.map((l) => {
      const certOk = l.organicCert?.status === 'VERIFIED' && l.organicCert.expiresAt > now;
      return { id: l.id, code: l.code, state: l.state, quantityKg: l.quantityKg, pricePaisePerKg: l.pricePaisePerKg, gmvPaise: BigInt(l.quantityKg) * l.pricePaisePerKg, pickupPin: l.pickupPin, createdAt: l.createdAt, isOrganic: certOk, commodity: { id: l.commodity.id, code: l.commodity.code, name: l.commodity.name, names: l.commodity.names }, grade: { id: l.grade.id, code: l.grade.code, name: l.grade.name, parameters: l.grade.parameters }, farmer: { name: l.farmer.user.name, type: l.farmer.type, fpoName: l.farmer.fpoName, district: l.farmer.district, state: l.farmer.state, phoneMasked: maskPhone(`+91000000${l.farmer.user.phoneLast4}`) } };
    });
  }

  async acceptListing(u: AuthUser, listingId: string, d: AcceptListingDto) {
    if (!d.acceptContract) throw new UnprocessableEntityException({ code: 'CONTRACT_NOT_ACCEPTED', message: 'You must accept the contract terms' });
    await this.requireKybVerified(u.id);
    const id = await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Listing" WHERE id = ${listingId} FOR UPDATE`;
      const l = await tx.listing.findUnique({ where: { id: listingId }, include: { farmer: true, organicCert: true } });
      if (!l) throw new NotFoundException('Listing not found');
      if (l.state !== 'LISTED') throw new ConflictException({ code: 'ILLEGAL_TRANSITION', message: 'This listing is no longer available' });
      await tx.listing.update({ where: { id: l.id }, data: { state: 'MATCHED' } });
      const organic = l.organicCert?.status === 'VERIFIED' && l.organicCert.expiresAt > this.clock.now();
      const o = await this.createOrder(tx, { flow: 'CATALOG', buyerId: u.id, farmer: l.farmer, commodityId: l.commodityId, gradeId: l.gradeId, quantityKg: l.quantityKg, pricePaisePerKg: l.pricePaisePerKg, pickupPin: l.pickupPin, deliveryPin: d.deliveryPin, listingId: l.id, isOrganic: !!organic, actorId: u.id });
      return o.id;
    });
    return this.view(u, id);
  }

  async withdrawListing(u: AuthUser, id: string) {
    const done = await this.prisma.listing.updateMany({ where: { id, farmerId: u.id, state: 'LISTED' }, data: { state: 'WITHDRAWN' } });
    if (!done.count) throw new ConflictException({ code: 'ILLEGAL_TRANSITION', message: 'This listing cannot be withdrawn' });
    return { withdrawn: true };
  }

  /** Daily job: an expired certificate loses its tag at the source too, not just at read time. */
  async expireOrganicCerts() {
    const now = this.clock.now();
    const r = await this.prisma.listing.updateMany({ where: { organicCert: { expiresAt: { lte: now } }, state: 'LISTED' }, data: { organicCertId: null } });
    return r.count;
  }

  async cancelOrder(u: AuthUser, id: string, reason: string) {
    const o = await this.prisma.order.findUnique({ where: { id } });
    if (!o || (u.role !== 'ADMIN' && o.buyerId !== u.id)) throw new NotFoundException('Order not found');
    await this.prisma.tx((tx) => this.engine.transition(tx, id, 'CANCELLED', { id: u.id, role: u.role }, { reason }));
    return this.view(u, id);
  }

  async addDispatchPhoto(u: AuthUser, orderId: string, fileId: string) {
    const o = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!o || o.farmerId !== u.id) throw new NotFoundException('Order not found');
    const f = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    if (!f || f.ownerId !== u.id || f.purpose !== 'DISPATCH_PHOTO' || !f.completedAt) throw new UnprocessableEntityException({ code: 'FILE_INVALID', message: 'Upload a dispatch photo first' });
    return this.prisma.dispatchPhoto.create({ data: { orderId, fileId } });
  }

  /** Farmer's own ledger view, including any negative balance. */
  async farmerLedger(u: AuthUser) {
    const owes = await this.ledger.farmerOwes(u.id);
    const payable = -(await this.ledger.balance(`farmer_payable:${u.id}`));
    const payouts = await this.prisma.payout.findMany({ where: { payeeId: u.id }, include: { order: { select: { code: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
    const entries = await this.prisma.ledgerPosting.findMany({ where: { account: { code: { in: [`farmer_payable:${u.id}`, `farmer_receivable:${u.id}`] } } }, include: { journal: true, account: true }, orderBy: { createdAt: 'desc' }, take: 200 });
    return {
      negativeBalancePaise: owes > 0n ? owes : 0n, payablePaise: payable,
      payouts: payouts.map((p) => ({ id: p.id, orderCode: p.order.code, amountPaise: p.amountPaise, status: p.status, statusNote: p.statusNote, createdAt: p.createdAt })),
      entries: entries.map((e) => ({ id: e.id, type: e.journal.type, memo: e.journal.memo, account: e.account.code.split(':')[0], orderId: e.journal.orderId, amountPaise: e.amountPaise, createdAt: e.createdAt })),
    };
  }
  async payeeEarnings(u: AuthUser) {
    const payouts = await this.prisma.payout.findMany({ where: { payeeId: u.id }, include: { order: { select: { code: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
    const total = payouts.filter((p) => p.status === 'PROCESSED').reduce((s, p) => s + p.amountPaise, 0n);
    return { totalPaidPaise: total, payouts: payouts.map((p) => ({ id: p.id, orderCode: p.order.code, amountPaise: p.amountPaise, status: p.status, statusNote: p.statusNote, createdAt: p.createdAt })) };
  }
}
