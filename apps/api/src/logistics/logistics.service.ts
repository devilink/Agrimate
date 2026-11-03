/** Freight quoting and booking, the partner trip workflow, PoD, and quality: disputes + organic spot tests. */
import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Order } from '@prisma/client';
import { computeFreight, discrepancyPercent, FreightQuote, pickVehicleTier, weightDisputeAllowed, normalisePhone } from '@agrimate/shared';
import { AuthUser } from '../auth/auth';
import { MAPS, MapsAdapter } from '../adapters/others';
import { AuditService, Clock, ConfigService, CryptoService, PrismaService, Tx } from '../core/core';
import { AlertsService, NotificationsService, OrderEngine, TimerService } from '../engine/engine';
import { FilesService } from '../onboarding/onboarding';
import { AcceptTripDto, ConfirmDeliveryDto, CreateDisputeDto, DeliverDto, EwayBillDto, ExternalLogisticsDto, ResolveDisputeDto, SpotResultDto } from '../orders/orders.dto';

@Injectable()
export class LogisticsService {
  constructor(private readonly prisma: PrismaService, private readonly clock: Clock, private readonly config: ConfigService, private readonly crypto: CryptoService, private readonly engine: OrderEngine, private readonly notifications: NotificationsService, private readonly files: FilesService, @Inject(MAPS) private readonly maps: MapsAdapter) {}

  /** Cached per PIN pair, so the same lane never costs a second Distance Matrix call. */
  async distance(originPin: string, destPin: string) {
    const hit = await this.prisma.distanceCache.findUnique({ where: { originPin_destPin: { originPin, destPin } } });
    if (hit) return hit.metres;
    const metres = await this.maps.distanceMetres(originPin, destPin);
    await this.prisma.distanceCache.upsert({ where: { originPin_destPin: { originPin, destPin } }, create: { originPin, destPin, metres, provider: this.maps.name }, update: {} });
    return metres;
  }

  private async quoteFor(o: Pick<Order, 'pickupPin' | 'deliveryPin' | 'quantityKg' | 'freightMarkupBps'>): Promise<FreightQuote & { tierCode: string; tierName: string }> {
    const tiers = await this.prisma.vehicleTier.findMany({ where: { active: true } });
    let tier;
    try { tier = pickVehicleTier(o.quantityKg, tiers); } catch { throw new UnprocessableEntityException({ code: 'NO_TIER', message: 'No vehicle tier can carry this load; split it or declare external transport' }); }
    const metres = await this.distance(o.pickupPin, o.deliveryPin);
    const loadingFeePaise = BigInt(await this.config.get('loadingFeePaise'));
    return { ...computeFreight({ distanceMetres: metres, vehicleRatePaisePerKm: tier.ratePaisePerKm, loadingFeePaise, quantityKg: o.quantityKg, markupBps: o.freightMarkupBps }), tierCode: tier.code, tierName: tier.name };
  }

  private async buyerOrder(db: Tx | PrismaService, u: AuthUser, id: string) {
    const o = await db.order.findUnique({ where: { id } });
    if (!o || (u.role !== 'ADMIN' && o.buyerId !== u.id)) throw new NotFoundException('Order not found');
    return o;
  }

  async quote(u: AuthUser, id: string) { return this.quoteFor(await this.buyerOrder(this.prisma, u, id)); }

  private assertBookable(o: Order) {
    if (o.state !== 'LOGISTICS_PENDING') throw new ConflictException({ code: 'ILLEGAL_TRANSITION', message: 'Logistics can only be arranged after the advance is locked' });
    if (o.logisticsMode) throw new ConflictException({ code: 'LOGISTICS_ALREADY_SET', message: 'Logistics are already arranged for this order' });
  }

  /** Creates the 100% freight tranche. The route is only offered to partners once that money is in escrow. */
  async bookPlatform(u: AuthUser, id: string) {
    const o0 = await this.buyerOrder(this.prisma, u, id);
    const q = await this.quoteFor(o0);
    return this.prisma.tx(async (tx) => {
      const o = await this.engine.lock(tx, id);
      this.assertBookable(o);
      await tx.order.update({ where: { id }, data: { logisticsMode: 'PLATFORM' } });
      await tx.tranche.create({ data: { orderId: id, kind: 'FREIGHT', expectedPaise: q.finalFreightPaise } });
      await tx.trip.create({ data: { orderId: id, tierCode: q.tierCode, distanceMetres: Math.round(q.distanceKm * 1000), ratePaisePerKm: q.vehicleRatePaisePerKm, loadingFeePaise: q.loadingFeePaise, baseCostPaise: q.baseCostPaise, markupPaise: q.markupPaise, finalFreightPaise: q.finalFreightPaise, displayPtkmPaise: q.displayPtkmPaise } });
      await this.engine.advance(tx, id);
      return { mode: 'PLATFORM', freightDuePaise: q.finalFreightPaise, quote: q };
    });
  }

  async declareExternal(u: AuthUser, id: string, d: ExternalLogisticsDto) {
    await this.buyerOrder(this.prisma, u, id);
    return this.prisma.tx(async (tx) => {
      const o = await this.engine.lock(tx, id);
      this.assertBookable(o);
      await tx.order.update({ where: { id }, data: { logisticsMode: 'EXTERNAL', externalVehicleNo: d.vehicleNo, externalDriverPhoneEnc: this.crypto.encrypt(normalisePhone(d.driverPhone)) } });
      const after = await this.engine.advance(tx, id);
      return { mode: 'EXTERNAL', state: after.state };
    });
  }

  /** External transport only; platform trips depart through the partner's pickup confirmation. */
  async depart(u: AuthUser, id: string) {
    return this.prisma.tx(async (tx) => {
      const o = await this.engine.lock(tx, id);
      if (u.role !== 'ADMIN' && o.buyerId !== u.id && o.farmerId !== u.id) throw new NotFoundException('Order not found');
      if (o.logisticsMode === 'PLATFORM') throw new ConflictException({ code: 'USE_TRIP_PICKUP', message: 'The logistics partner confirms departure for platform trips' });
      return this.engine.transition(tx, id, 'IN_TRANSIT', { id: u.id, role: u.role }, {});
    });
  }

  /** External transport: the buyer's confirmation with received weight is the PoD. */
  async confirmDelivery(u: AuthUser, id: string, d: ConfirmDeliveryDto) {
    return this.prisma.tx(async (tx) => {
      const o = await this.engine.lock(tx, id);
      if (o.buyerId !== u.id && u.role !== 'ADMIN') throw new NotFoundException('Order not found');
      if (o.logisticsMode === 'PLATFORM') throw new ConflictException({ code: 'USE_TRIP_POD', message: 'The driver records PoD for platform trips' });
      if (o.state !== 'IN_TRANSIT') throw new ConflictException({ code: 'ILLEGAL_TRANSITION', message: 'The order is not in transit' });
      await tx.order.update({ where: { id }, data: { deliveredAt: this.clock.now(), receivedWeightKg: d.receivedWeightKg } });
      return this.engine.transition(tx, id, 'DELIVERED', { id: u.id, role: u.role }, { receivedWeightKg: d.receivedWeightKg, podPhotoFileId: d.podPhotoFileId });
    });
  }

  // ---- Partner side --------------------------------------------------------------------------------------------
  private async verifiedPartner(u: AuthUser) {
    const p = await this.prisma.logisticsProfile.findUniqueOrThrow({ where: { userId: u.id } });
    if (p.status !== 'VERIFIED') throw new ForbiddenException({ code: 'PARTNER_NOT_APPROVED', message: 'Your documents are not approved yet' });
    return p;
  }
  /** Minimal payloads for low-bandwidth use. Only funded trips appear, which is the PRD's dispatch guard. */
  async available(u: AuthUser) {
    await this.verifiedPartner(u);
    const trips = await this.prisma.trip.findMany({ where: { status: 'OPEN', fundedAt: { not: null } }, include: { order: { include: { commodity: true } } }, orderBy: { createdAt: 'desc' }, take: 50 });
    return trips.map((t) => ({ id: t.id, orderCode: t.order.code, commodity: t.order.commodity.name, quantityKg: t.order.quantityKg, pickupPin: t.order.pickupPin, dropPin: t.order.deliveryPin, distanceKm: t.distanceMetres / 1000, tierCode: t.tierCode, payoutPaise: t.baseCostPaise, slaDeadlineAt: t.order.slaDeadlineAt }));
  }
  async mine(u: AuthUser) {
    const trips = await this.prisma.trip.findMany({ where: { partnerId: u.id }, include: { order: { include: { commodity: true } }, vehicle: true }, orderBy: { updatedAt: 'desc' }, take: 100 });
    return trips.map((t) => ({ id: t.id, orderId: t.orderId, orderCode: t.order.code, orderState: t.order.state, status: t.status, commodity: t.order.commodity.name, quantityKg: t.order.quantityKg, pickupPin: t.order.pickupPin, pickupLat: t.order.pickupLat, pickupLng: t.order.pickupLng, dropPin: t.order.deliveryPin, distanceKm: t.distanceMetres / 1000, payoutPaise: t.baseCostPaise, vehicleRegNo: t.vehicle?.regNo, ewayBillNumber: t.ewayBillNumber, pickedUpAt: t.pickedUpAt, deliveredAt: t.deliveredAt }));
  }
  private async myTrip(tx: Tx | PrismaService, u: AuthUser, id: string) {
    const t = await tx.trip.findUnique({ where: { id }, include: { order: true } });
    if (!t || t.partnerId !== u.id) throw new NotFoundException('Trip not found');
    return t;
  }

  /** Atomic claim: when two drivers tap accept together, exactly one wins. */
  async accept(u: AuthUser, id: string, d: AcceptTripDto) {
    await this.verifiedPartner(u);
    if (!d.noCoLoadingAttested) throw new UnprocessableEntityException({ code: 'NO_CO_LOADING_REQUIRED', message: 'You must attest that no other commercial goods will be carried' });
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: d.vehicleId } });
    if (!vehicle || vehicle.partnerId !== u.id || !vehicle.active) throw new UnprocessableEntityException({ code: 'VEHICLE_INVALID', message: 'That vehicle is not yours' });
    const trip = await this.prisma.trip.findUnique({ where: { id }, include: { order: true } });
    if (!trip) throw new NotFoundException('Trip not found');
    if (vehicle.capacityKg < trip.order.quantityKg) throw new UnprocessableEntityException({ code: 'VEHICLE_TOO_SMALL', message: 'This vehicle cannot carry the load' });
    const now = this.clock.now();
    const won = await this.prisma.trip.updateMany({ where: { id, status: 'OPEN', fundedAt: { not: null } }, data: { status: 'ACCEPTED', partnerId: u.id, vehicleId: vehicle.id, acceptedAt: now, noCoLoadingAttestedAt: now } });
    if (!won.count) throw new ConflictException({ code: 'TRIP_TAKEN', message: 'This route is no longer available' });
    return { id, status: 'ACCEPTED' };
  }

  async uploadEway(u: AuthUser, id: string, d: EwayBillDto) {
    const t = await this.myTrip(this.prisma, u, id);
    if (t.status !== 'ACCEPTED') throw new ConflictException({ code: 'ILLEGAL_TRANSITION', message: 'E-Way bill goes in after accepting and before pickup' });
    const f = await this.files.requireCompleted(this.prisma, u.id, d.fileId, ['EWAY_BILL']);
    await this.prisma.fileObject.update({ where: { id: f.id }, data: { orderId: t.orderId } });
    return this.prisma.trip.update({ where: { id }, data: { ewayBillFileId: d.fileId, ewayBillNumber: d.ewayBillNumber }, select: { id: true, ewayBillNumber: true, status: true } });
  }

  /** Departure. The engine enforces balance + inspection + freight; this adds the E-Way bill and issues the receiver OTP. */
  async pickup(u: AuthUser, id: string) {
    return this.prisma.tx(async (tx) => {
      const t = await this.myTrip(tx, u, id);
      if (t.status !== 'ACCEPTED') throw new ConflictException({ code: 'ILLEGAL_TRANSITION', message: 'Trip must be accepted first' });
      if (!t.ewayBillFileId) throw new UnprocessableEntityException({ code: 'EWAY_BILL_REQUIRED', message: 'Upload the E-Way bill first' });
      await this.engine.transition(tx, t.orderId, 'IN_TRANSIT', { id: u.id, role: 'LOGISTICS' }, { tripId: id });
      const otp = this.crypto.randomDigits(6);
      await tx.trip.update({ where: { id }, data: { status: 'PICKED_UP', pickedUpAt: this.clock.now(), receiverOtpHash: this.crypto.blindIndex(`${id}:${otp}`) } });
      await this.notifications.enqueue(tx, t.order.buyerId, 'delivery_otp', { code: t.order.code, otp }, `delivery-otp:${id}`);
      return { id, status: 'PICKED_UP' };
    });
  }

  /** Digital PoD: photo + GPS + (receiver OTP or signature) + received weight. This is what releases the freight payout. */
  async deliver(u: AuthUser, id: string, d: DeliverDto) {
    return this.prisma.tx(async (tx) => {
      const t = await this.myTrip(tx, u, id);
      if (t.status !== 'PICKED_UP') throw new ConflictException({ code: 'ILLEGAL_TRANSITION', message: 'Trip is not in transit' });
      await this.files.requireCompleted(tx, u.id, d.podPhotoFileId, ['POD_PHOTO']);
      const otpOk = !!d.receiverOtp && !!t.receiverOtpHash && this.crypto.blindIndex(`${id}:${d.receiverOtp}`) === t.receiverOtpHash;
      if (d.receiverOtp && !otpOk) throw new UnprocessableEntityException({ code: 'RECEIVER_OTP_INVALID', message: 'Wrong delivery code' });
      if (!otpOk && !d.signatureFileId) throw new UnprocessableEntityException({ code: 'POD_PROOF_REQUIRED', message: 'A receiver code or signature is required' });
      if (d.signatureFileId) await this.files.requireCompleted(tx, u.id, d.signatureFileId, ['POD_SIGNATURE']);
      const now = this.clock.now();
      await tx.fileObject.updateMany({ where: { id: { in: [d.podPhotoFileId, ...(d.signatureFileId ? [d.signatureFileId] : [])] } }, data: { orderId: t.orderId } });
      await tx.trip.update({ where: { id }, data: { status: 'DELIVERED', deliveredAt: now, podPhotoFileId: d.podPhotoFileId, podSignatureFileId: d.signatureFileId, podLat: d.lat, podLng: d.lng, podOtpVerified: otpOk } });
      await tx.order.update({ where: { id: t.orderId }, data: { deliveredAt: now, receivedWeightKg: d.receivedWeightKg } });
      await this.engine.transition(tx, t.orderId, 'DELIVERED', { id: u.id, role: 'LOGISTICS' }, { tripId: id, receivedWeightKg: d.receivedWeightKg, otpVerified: otpOk });
      return { id, status: 'DELIVERED' };
    });
  }
}

// ---- Quality ---------------------------------------------------------------------------------------------------------
@Injectable()
export class DisputesService {
  constructor(private readonly prisma: PrismaService, private readonly clock: Clock, private readonly config: ConfigService, private readonly engine: OrderEngine, private readonly files: FilesService, private readonly timers: TimerService, private readonly alerts: AlertsService, private readonly audit: AuditService) {}

  private windowOpen(o: Order) { return o.state === 'DISPUTE_WINDOW' && !!o.disputeDeadlineAt && o.disputeDeadlineAt > this.clock.now(); }

  /** What the UI needs to enable or block the dispute button. The API re-checks all of it on submit. */
  async eligibility(u: AuthUser, orderId: string) {
    const o = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!o || (u.role !== 'ADMIN' && o.buyerId !== u.id)) throw new NotFoundException('Order not found');
    const open = this.windowOpen(o);
    const dispatched = o.dispatchedWeightKg; const received = o.receivedWeightKg;
    const pct = dispatched && received != null ? discrepancyPercent(dispatched, received) : null;
    const weightAllowed = open && !!dispatched && received != null && weightDisputeAllowed(dispatched, received);
    return { windowOpen: open, disputeDeadlineAt: o.disputeDeadlineAt, dispatchedWeightKg: dispatched, receivedWeightKg: received, discrepancyPercent: pct, tolerancePercent: 2.5, weightDisputeAllowed: weightAllowed, qualityDisputeAllowed: open, spotTestAllowed: open && o.isOrganic };
  }

  async raise(u: AuthUser, orderId: string, d: CreateDisputeDto) {
    return this.prisma.tx(async (tx) => {
      const o = await this.engine.lock(tx, orderId);
      if (o.buyerId !== u.id) throw new NotFoundException('Order not found');
      if (!this.windowOpen(o)) throw new ConflictException({ code: 'DISPUTE_WINDOW_CLOSED', message: 'Disputes can only be raised during the dispute window' });
      let discrepancy: number | null = null;
      if (d.type === 'WEIGHT') {
        if (!o.dispatchedWeightKg || o.receivedWeightKg == null) throw new ConflictException({ code: 'WEIGHT_NOT_RECORDED', message: 'Weights have not been recorded' });
        discrepancy = discrepancyPercent(o.dispatchedWeightKg, o.receivedWeightKg);
        // The contractual 2.5% shrinkage guard. Weights come from the certified scale and PoD, never from this request.
        if (!weightDisputeAllowed(o.dispatchedWeightKg, o.receivedWeightKg)) throw new UnprocessableEntityException({ code: 'WITHIN_SHRINKAGE_TOLERANCE', message: `A ${discrepancy}% difference is within the contractual 2.5% tolerance`, discrepancyPercent: discrepancy });
        if (!d.evidenceFileIds.length) throw new UnprocessableEntityException({ code: 'EVIDENCE_REQUIRED', message: 'Upload evidence for a weight dispute' });
      }
      for (const f of d.evidenceFileIds) {
        await this.files.requireCompleted(tx, u.id, f, ['DISPUTE_EVIDENCE', 'SPOT_TEST_REPORT']);
        await tx.fileObject.update({ where: { id: f }, data: { orderId } });
      }
      const dispute = await tx.dispute.create({ data: { orderId, raisedBy: u.id, type: d.type, reason: d.reason, evidenceFileIds: d.evidenceFileIds, discrepancyPercent: discrepancy } });
      await this.engine.transition(tx, orderId, 'DISPUTED', { id: u.id, role: 'BUYER' }, { disputeId: dispute.id, type: d.type });
      return dispute;
    });
  }

  /** Requesting a spot test extends the window, since lab results take days. Settlement waits for the result. */
  async requestSpotTest(u: AuthUser, orderId: string) {
    return this.prisma.tx(async (tx) => {
      const o = await this.engine.lock(tx, orderId);
      if (o.buyerId !== u.id) throw new NotFoundException('Order not found');
      if (!o.isOrganic) throw new UnprocessableEntityException({ code: 'NOT_ORGANIC', message: 'Spot testing applies to organic orders' });
      if (!this.windowOpen(o)) throw new ConflictException({ code: 'DISPUTE_WINDOW_CLOSED', message: 'Spot tests can only be requested during the dispute window' });
      const hours = await this.config.get('spotTestExtensionHours', tx);
      const deadline = new Date(o.disputeDeadlineAt!.getTime() + hours * 3_600_000);
      await tx.order.update({ where: { id: orderId }, data: { disputeDeadlineAt: deadline } });
      await this.timers.cancelAll(tx, orderId, ['DISPUTE_WINDOW_END']);
      await this.timers.schedule(tx, orderId, 'DISPUTE_WINDOW_END', deadline);
      return tx.spotTest.create({ data: { orderId, requestedBy: u.id } });
    });
  }

  /** A failed result opens a quality dispute automatically. A pass settles once the window has elapsed. */
  async spotResult(u: AuthUser, id: string, d: SpotResultDto) {
    return this.prisma.tx(async (tx) => {
      const test = await tx.spotTest.findUnique({ where: { id } });
      if (!test) throw new NotFoundException('Spot test not found');
      const o = await this.engine.lock(tx, test.orderId);
      if (u.role !== 'ADMIN' && o.buyerId !== u.id) throw new NotFoundException('Spot test not found');
      if (test.status !== 'REQUESTED') throw new ConflictException({ code: 'ILLEGAL_TRANSITION', message: 'Result already recorded' });
      await this.files.requireCompleted(tx, u.id, d.reportFileId, ['SPOT_TEST_REPORT']);
      await tx.fileObject.update({ where: { id: d.reportFileId }, data: { orderId: o.id } });
      const updated = await tx.spotTest.update({ where: { id }, data: { status: d.passed ? 'PASSED' : 'FAILED', reportFileId: d.reportFileId, resultNote: d.note } });
      if (!d.passed && o.state === 'DISPUTE_WINDOW') {
        const dispute = await tx.dispute.create({ data: { orderId: o.id, raisedBy: o.buyerId, type: 'QUALITY', reason: d.note ?? 'Pesticide spot test failed', evidenceFileIds: [d.reportFileId] } });
        await this.engine.transition(tx, o.id, 'DISPUTED', { id: null, role: 'SYSTEM' }, { disputeId: dispute.id, spotTestId: id });
      }
      return updated;
    });
  }

  /** Once the last open dispute closes, the order resolves and moves straight on to settlement or refund. */
  async resolve(admin: AuthUser, id: string, d: ResolveDisputeDto) {
    return this.prisma.tx(async (tx) => {
      const dispute = await tx.dispute.findUnique({ where: { id } });
      if (!dispute) throw new NotFoundException('Dispute not found');
      const o = await this.engine.lock(tx, dispute.orderId);
      if (dispute.status !== 'OPEN') throw new ConflictException({ code: 'ILLEGAL_TRANSITION', message: 'Dispute already resolved' });
      const refund = d.outcome === 'PARTIAL_REFUND' ? BigInt(d.refundPaise ?? '0') : 0n;
      if (d.outcome === 'PARTIAL_REFUND' && (refund <= 0n || refund > o.gmvPaise - o.buyerRefundPaise)) throw new UnprocessableEntityException({ code: 'REFUND_INVALID', message: 'Partial refund must be above zero and within GMV' });
      await tx.dispute.update({ where: { id }, data: { status: 'RESOLVED', outcome: d.outcome, refundPaise: refund, resolutionNote: d.note, resolvedBy: admin.id, resolvedAt: this.clock.now() } });
      if (refund > 0n) await tx.order.update({ where: { id: o.id }, data: { buyerRefundPaise: o.buyerRefundPaise + refund } });
      await this.audit.log({ actorId: admin.id, actorRole: admin.role, action: 'DISPUTE_RESOLVED', entity: 'Dispute', entityId: id, data: { outcome: d.outcome, refundPaise: refund.toString(), note: d.note } }, tx);
      const remaining = await tx.dispute.count({ where: { orderId: o.id, status: 'OPEN' } });
      if (remaining) return { orderState: o.state, remainingDisputes: remaining };
      const actor = { id: admin.id, role: 'ADMIN' as const };
      await this.engine.transition(tx, o.id, 'RESOLVED', actor, { disputeId: id, outcome: d.outcome });
      const anyFull = d.outcome === 'FULL_REFUND_FARMER_FAULT' || (await tx.dispute.count({ where: { orderId: o.id, outcome: 'FULL_REFUND_FARMER_FAULT' } })) > 0;
      const after = await this.engine.transition(tx, o.id, anyFull ? 'REFUNDED' : 'SETTLED', actor, { farmerFault: anyFull });
      return { orderState: after.state, remainingDisputes: 0 };
    });
  }

  async list(status?: string) {
    return this.prisma.dispute.findMany({ where: status ? { status: status as 'OPEN' | 'RESOLVED' } : {}, include: { order: { select: { code: true, state: true, dispatchedWeightKg: true, receivedWeightKg: true, gmvPaise: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
  }
}
