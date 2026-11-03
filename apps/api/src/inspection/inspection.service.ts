/** SLA clock, inspector auto-assignment with escalation ladder, inspection workflow, self-certification fallback. */
import { ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit, UnprocessableEntityException } from '@nestjs/common';
import { Order, Prisma } from '@prisma/client';
import { addHours, checkReadings, formatIST, GradeParameter, haversineMetres, inspectionDay, istDateString, selfCertFallbackAt, slaDeadline, startOfIstDay, withinRadius } from '@agrimate/shared';
import { AuthUser } from '../auth/auth';
import { AuditService, Clock, ConfigService, CryptoService, PrismaService, Tx } from '../core/core';
import { AlertsService, JobsService, NotificationsService, OrderEngine, SYSTEM_ACTOR, TimerService } from '../engine/engine';
import { FilesService } from '../onboarding/onboarding';
import { SettlementService } from '../payments/settlement.service';
import { CaptureSessionDto, ClipDto, GeoDto, GradingDto, SubmitSelfCertDto } from '../orders/orders.dto';

@Injectable()
export class InspectionService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService, private readonly clock: Clock, private readonly config: ConfigService, private readonly crypto: CryptoService, private readonly engine: OrderEngine, private readonly timers: TimerService,
    private readonly alerts: AlertsService, private readonly notifications: NotificationsService, private readonly settlement: SettlementService, private readonly files: FilesService, private readonly audit: AuditService, private readonly jobs: JobsService,
  ) {}

  onModuleInit() {
    this.engine.register('START_SLA', ({ tx, order }) => this.startSla(tx, order));
    this.engine.register('ASSIGN_INSPECTOR', ({ tx, order }) => this.createAndAssign(tx, order));
    this.engine.register('OPEN_DISPUTE_WINDOW', ({ tx, order }) => this.openDisputeWindow(tx, order));
    for (const k of ['REMINDER_T24', 'REMINDER_T6', 'REMINDER_T1'] as const) this.timers.onFire(k, (tx, o) => this.remind(tx, o, k));
    this.timers.onFire('SLA_BREACH', (tx, o) => this.onBreach(tx, o));
    this.timers.onFire('INSPECTOR_RETRY', (tx, o) => this.retryAssign(tx, o));
    this.timers.onFire('SELF_CERT_FALLBACK', (tx, o) => this.onFallback(tx, o));
    this.timers.onFire('DISPUTE_WINDOW_END', (tx, o) => this.onWindowEnd(tx, o));
    this.jobs.on('sla-timer', (d) => this.timers.fire(d.timerId as string));
    this.jobs.repeat('sla-sweep', () => this.timers.fireDue(), { every: 30_000 });
  }

  // ---- SLA -----------------------------------------------------------------------------------------------------
  /** T0 is when the advance was credited: that is what legally binds the contract and starts the clock. */
  private async startSla(tx: Tx, order: Order) {
    const t0 = this.clock.now();
    const endOfDay = await this.config.get('slaEndOfDay', tx);
    const deadline = slaDeadline(t0, order.slaDays, endOfDay);
    const day = inspectionDay(t0, order.slaDays);
    await tx.order.update({ where: { id: order.id }, data: { t0At: t0, slaDeadlineAt: deadline, inspectionDayAt: day } });
    for (const [kind, hours] of [['REMINDER_T24', 24], ['REMINDER_T6', 6], ['REMINDER_T1', 1]] as const) {
      const at = addHours(deadline, -hours);
      if (at > t0) await this.timers.schedule(tx, order.id, kind, at);
    }
    await this.timers.schedule(tx, order.id, 'SLA_BREACH', deadline);
    await this.timers.schedule(tx, order.id, 'SELF_CERT_FALLBACK', selfCertFallbackAt(t0, order.slaDays, await this.config.get('selfCertFallbackHours', tx)));
    await this.notifications.enqueue(tx, order.farmerId, 'harvest_now', { code: order.code, deadline: formatIST(deadline), inspectionDay: istDateString(day) });
  }

  private async remind(tx: Tx, o: Order, kind: string) {
    if (['IN_TRANSIT', 'DELIVERED', 'DISPUTE_WINDOW', 'SETTLED', 'REFUNDED', 'CANCELLED', 'FARMER_DEFAULTED', 'BUYER_DEFAULTED', 'DISPUTED', 'RESOLVED'].includes(o.state)) return;
    const hours = kind.replace('REMINDER_T', '');
    const params = { code: o.code, hours, deadline: o.slaDeadlineAt ? formatIST(o.slaDeadlineAt) : '' };
    for (const uid of [o.buyerId, o.farmerId]) await this.notifications.enqueue(tx, uid, 'sla_reminder', params, `sla:${o.id}:${uid}:${kind}`);
  }

  /** Unpaid balance at the deadline is a buyer default. Anything later is a judgement call, so it goes to the ops board. */
  private async onBreach(tx: Tx, o: Order) {
    if (['ADVANCE_LOCKED', 'LOGISTICS_PENDING', 'LOGISTICS_SECURED', 'AWAITING_BALANCE'].includes(o.state)) {
      await this.engine.transition(tx, o.id, 'BUYER_DEFAULTED', SYSTEM_ACTOR, { reason: 'SLA breached before funding completed' });
      return;
    }
    if (['FULLY_FUNDED', 'INSPECTION_SCHEDULED', 'INSPECTED', 'SELF_CERTIFIED'].includes(o.state)) {
      await this.alerts.raise(tx, 'SLA_BREACH', `Order ${o.code} passed its SLA deadline in ${o.state}`, o.id);
    }
  }

  private async openDisputeWindow(tx: Tx, o: Order) {
    const deadline = addHours(this.clock.now(), o.disputeWindowHours);
    await tx.order.update({ where: { id: o.id }, data: { disputeDeadlineAt: deadline } });
    await this.timers.schedule(tx, o.id, 'DISPUTE_WINDOW_END', deadline);
  }

  /** Auto-settles if nothing is holding it. A pending spot test holds it; admin sees an alert. */
  private async onWindowEnd(tx: Tx, o: Order) {
    if (o.state !== 'DISPUTE_WINDOW') return;
    const pending = await tx.spotTest.count({ where: { orderId: o.id, status: 'REQUESTED' } });
    if (pending) { await this.alerts.raise(tx, 'SLA_BREACH', `Order ${o.code}: spot test result overdue; settlement is on hold`, o.id); return; }
    await this.engine.transition(tx, o.id, 'SETTLED', SYSTEM_ACTOR, { reason: 'Dispute window elapsed' });
  }

  // ---- Assignment ----------------------------------------------------------------------------------------------
  private async createAndAssign(tx: Tx, order: Order) {
    const t0 = this.clock.now();
    await tx.inspection.create({ data: { orderId: order.id, scheduledFor: inspectionDay(t0, order.slaDays) } });
    await this.tryAssign(tx, order.id);
  }

  /** Nearest approved, available inspector within their service radius who isn't at their daily cap. */
  private async findInspector(tx: Tx, order: Pick<Order, 'pickupLat' | 'pickupLng'>, scheduledFor: Date, exclude: string[] = []) {
    const maxJobs = await this.config.get('inspectorMaxJobsPerDay', tx);
    const candidates = await tx.inspectorProfile.findMany({ where: { status: 'VERIFIED', available: true, lat: { not: null }, lng: { not: null }, userId: { notIn: exclude } } });
    const ranked = candidates
      .map((c) => ({ c, metres: haversineMetres({ lat: c.lat!, lng: c.lng! }, { lat: order.pickupLat, lng: order.pickupLng }) }))
      .filter((x) => x.metres <= x.c.serviceRadiusKm * 1000)
      .sort((a, b) => a.metres - b.metres);
    const dayStart = startOfIstDay(scheduledFor);
    for (const { c } of ranked) {
      const load = await tx.inspection.count({ where: { inspectorId: c.userId, scheduledFor: dayStart, status: { in: ['ASSIGNED', 'CHECKED_IN', 'INSPECTED'] } } });
      if (load < maxJobs) return c;
    }
    return null;
  }

  private async tryAssign(tx: Tx, orderId: string, exclude: string[] = []) {
    const insp = await tx.inspection.findUniqueOrThrow({ where: { orderId }, include: { order: true } });
    const found = await this.findInspector(tx, insp.order, insp.scheduledFor, exclude);
    const attempts = insp.assignAttempts + 1;
    if (found) {
      await tx.inspection.update({ where: { orderId }, data: { inspectorId: found.userId, status: 'ASSIGNED', assignAttempts: attempts } });
      await this.notifications.enqueue(tx, found.userId, 'inspector_job', { code: insp.order.code, inspectionDay: istDateString(insp.scheduledFor) });
      return true;
    }
    await tx.inspection.update({ where: { orderId }, data: { assignAttempts: attempts } });
    const maxAttempts = await this.config.get('inspectorMaxAttempts', tx);
    if (attempts >= maxAttempts) {
      await this.alerts.raise(tx, 'INSPECTOR_ESCALATION', `Order ${insp.order.code}: no inspector after ${attempts} attempts; assign manually`, orderId);
    } else {
      await this.timers.schedule(tx, orderId, 'INSPECTOR_RETRY', addHours(this.clock.now(), await this.config.get('inspectorRetryHours', tx)));
    }
    return false;
  }

  private async retryAssign(tx: Tx, o: Order) {
    const i = await tx.inspection.findUnique({ where: { orderId: o.id } });
    if (i?.status === 'UNASSIGNED' && !o.selfCertRequired) await this.tryAssign(tx, o.id);
  }

  private async onFallback(tx: Tx, o: Order) {
    const i = await tx.inspection.findUnique({ where: { orderId: o.id } });
    if (i?.status === 'UNASSIGNED') await this.routeToSelfCert(tx, o);
  }

  private async routeToSelfCert(tx: Tx, o: Pick<Order, 'id' | 'code' | 'farmerId'>) {
    await tx.inspection.update({ where: { orderId: o.id }, data: { status: 'WAIVED_SELF_CERT', inspectorId: null } });
    await tx.order.update({ where: { id: o.id }, data: { selfCertRequired: true } });
    await tx.slaTimer.updateMany({ where: { orderId: o.id, kind: 'INSPECTOR_RETRY', status: 'PENDING' }, data: { status: 'CANCELLED' } });
    await this.notifications.enqueue(tx, o.farmerId, 'self_cert_required', { code: o.code });
  }

  async manualAssign(admin: AuthUser, orderId: string, inspectorId: string) {
    return this.prisma.tx(async (tx) => {
      const insp = await tx.inspection.findUnique({ where: { orderId }, include: { order: true } });
      if (!insp) throw new NotFoundException('Inspection not found');
      if (insp.status === 'INSPECTED') throw new ConflictException({ code: 'ALREADY_INSPECTED', message: 'Already inspected' });
      const p = await tx.inspectorProfile.findUnique({ where: { userId: inspectorId } });
      if (!p || p.status !== 'VERIFIED') throw new UnprocessableEntityException({ code: 'INSPECTOR_NOT_APPROVED', message: 'That inspector is not approved' });
      await tx.order.update({ where: { id: orderId }, data: { selfCertRequired: false } });
      const u = await tx.inspection.update({ where: { orderId }, data: { inspectorId, status: 'ASSIGNED' } });
      await this.notifications.enqueue(tx, inspectorId, 'inspector_job', { code: insp.order.code, inspectionDay: istDateString(insp.scheduledFor) });
      await this.audit.log({ actorId: admin.id, actorRole: admin.role, action: 'INSPECTOR_MANUALLY_ASSIGNED', entity: 'Inspection', entityId: u.id, data: { inspectorId } }, tx);
      return u;
    });
  }

  // ---- Inspector workflow --------------------------------------------------------------------------------------
  private async mine(tx: Tx | PrismaService, u: AuthUser, id: string) {
    const i = await tx.inspection.findUnique({ where: { id }, include: { order: { include: { grade: true, commodity: true } } } });
    if (!i || i.inspectorId !== u.id) throw new NotFoundException('Job not found');
    return i;
  }

  async jobs_(u: AuthUser) {
    const rows = await this.prisma.inspection.findMany({ where: { inspectorId: u.id }, include: { order: { include: { grade: true, commodity: true } } }, orderBy: { scheduledFor: 'asc' }, take: 200 });
    return rows.map((i) => ({ id: i.id, orderId: i.orderId, orderCode: i.order.code, orderState: i.order.state, status: i.status, scheduledFor: i.scheduledFor, commodity: i.order.commodity.name, grade: i.order.grade.name, quantityKg: i.order.quantityKg, pickupPin: i.order.pickupPin, pickupLat: i.order.pickupLat, pickupLng: i.order.pickupLng, parameters: i.order.grade.parameters, checkInAt: i.checkInAt, readings: i.readings, scaleWeightKg: i.scaleWeightKg, photoFileIds: i.photoFileIds }));
  }

  async checkIn(u: AuthUser, id: string, d: GeoDto) {
    const i = await this.mine(this.prisma, u, id);
    if (i.status !== 'ASSIGNED' && i.status !== 'CHECKED_IN') throw new ConflictException({ code: 'ILLEGAL_TRANSITION', message: `Cannot check in while ${i.status}` });
    const radius = await this.config.get('checkInRadiusMetres');
    const pickup = { lat: i.order.pickupLat, lng: i.order.pickupLng };
    const metres = haversineMetres(d, pickup);
    if (!withinRadius(d, pickup, radius)) throw new UnprocessableEntityException({ code: 'OUTSIDE_RADIUS', message: `You are ${metres} m from the pickup point; you must be within ${radius} m`, metres, radius });
    return this.prisma.inspection.update({ where: { id }, data: { status: 'CHECKED_IN', checkInAt: this.clock.now(), checkInLat: d.lat, checkInLng: d.lng, checkInMetres: metres } });
  }

  async saveGrading(u: AuthUser, id: string, d: GradingDto) {
    const i = await this.mine(this.prisma, u, id);
    if (i.status !== 'CHECKED_IN') throw new ConflictException({ code: 'CHECK_IN_REQUIRED', message: 'Check in at the pickup point first' });
    for (const f of d.photoFileIds) await this.files.requireCompleted(this.prisma, u.id, f, ['INSPECTION_PHOTO']);
    const check = checkReadings(i.order.grade.parameters as unknown as GradeParameter[], d.readings);
    if (check.missing.length || check.invalid.length) throw new UnprocessableEntityException({ code: 'GRADING_INCOMPLETE', message: 'Grading form is incomplete', ...check });
    // Linking the photos to the order is what lets the buyer open them from the inspection report.
    await this.prisma.fileObject.updateMany({ where: { id: { in: d.photoFileIds } }, data: { orderId: i.orderId } });
    return this.prisma.inspection.update({ where: { id }, data: { readings: d.readings, scaleWeightKg: d.scaleWeightKg, photoFileIds: d.photoFileIds, gradeCheck: check as unknown as Prisma.InputJsonValue } });
  }

  /** Blocked until check-in, the full form and photos exist. Out-of-spec produce does not pass: the buyer or admin decides. */
  async markInspected(u: AuthUser, id: string) {
    return this.prisma.tx(async (tx) => {
      const i = await this.mine(tx, u, id);
      await this.engine.lock(tx, i.orderId);
      if (!i.checkInAt) throw new UnprocessableEntityException({ code: 'CHECK_IN_REQUIRED', message: 'GPS check-in is required' });
      if (i.status !== 'CHECKED_IN') throw new ConflictException({ code: 'ILLEGAL_TRANSITION', message: `Cannot mark inspected while ${i.status}` });
      if (!i.readings || !i.scaleWeightKg || !i.photoFileIds.length) throw new UnprocessableEntityException({ code: 'GRADING_INCOMPLETE', message: 'Readings, weight and photos are all required' });
      const check = i.gradeCheck as { ok: boolean; outOfSpec: string[] };
      if (!check.ok) {
        await tx.inspection.update({ where: { id }, data: { status: 'FAILED_GRADE', inspectedAt: this.clock.now() } });
        await this.alerts.raise(tx, 'INSPECTION_FAILED', `Order ${i.order.code}: out of spec on ${check.outOfSpec.join(', ')}`, i.orderId, { outOfSpec: check.outOfSpec });
        await this.notifications.enqueue(tx, i.order.buyerId, 'order_state', { code: i.order.code, state: 'INSPECTION_FAILED' });
        return { result: 'FAILED_GRADE', outOfSpec: check.outOfSpec };
      }
      if (i.order.state !== 'INSPECTION_SCHEDULED') throw new ConflictException({ code: 'GUARD_FAILED', message: 'The order is not fully funded yet, so inspection cannot be closed' });
      await tx.inspection.update({ where: { id }, data: { status: 'INSPECTED', inspectedAt: this.clock.now() } });
      await tx.order.update({ where: { id: i.orderId }, data: { dispatchedWeightKg: i.scaleWeightKg } });
      await this.engine.transition(tx, i.orderId, 'INSPECTED', { id: u.id, role: 'INSPECTOR' }, { scaleWeightKg: i.scaleWeightKg });
      await this.settlement.accrueInspectorFee(tx, i.order, u.id);
      return { result: 'INSPECTED' };
    });
  }

  /** The buyer may knowingly take out-of-spec produce rather than walk away. */
  async acceptDeviation(u: AuthUser, orderId: string) {
    return this.prisma.tx(async (tx) => {
      const o = await this.engine.lock(tx, orderId);
      if (o.buyerId !== u.id) throw new NotFoundException('Order not found');
      const i = await tx.inspection.findUnique({ where: { orderId } });
      if (i?.status !== 'FAILED_GRADE' || !i.inspectorId) throw new ConflictException({ code: 'ILLEGAL_TRANSITION', message: 'There is no failed inspection to accept' });
      if (o.state !== 'INSPECTION_SCHEDULED') throw new ConflictException({ code: 'GUARD_FAILED', message: 'Pay the balance before accepting the deviation' });
      await tx.inspection.update({ where: { orderId }, data: { status: 'INSPECTED', deviationAcceptedAt: this.clock.now() } });
      await tx.order.update({ where: { id: orderId }, data: { dispatchedWeightKg: i.scaleWeightKg } });
      await this.engine.transition(tx, orderId, 'INSPECTED', { id: u.id, role: 'BUYER' }, { deviationAccepted: true });
      await this.settlement.accrueInspectorFee(tx, o, i.inspectorId);
      return { result: 'INSPECTED' };
    });
  }

  /** Inspector backs out: try someone else right away; if nobody can take it, the farmer self-certifies. */
  async cancelJob(u: AuthUser, id: string) {
    return this.prisma.tx(async (tx) => {
      const i = await this.mine(tx, u, id);
      if (!['ASSIGNED', 'CHECKED_IN'].includes(i.status)) throw new ConflictException({ code: 'ILLEGAL_TRANSITION', message: 'This job can no longer be cancelled' });
      await tx.inspection.update({ where: { id }, data: { status: 'UNASSIGNED', inspectorId: null, checkInAt: null, readings: Prisma.JsonNull, scaleWeightKg: null, photoFileIds: [] } });
      const reassigned = await this.tryAssign(tx, i.orderId, [u.id]);
      if (!reassigned) await this.routeToSelfCert(tx, i.order);
      return { reassigned, selfCertRequired: !reassigned };
    });
  }

  // ---- Self-certification ---------------------------------------------------------------------------------------
  private async selfCertOrder(db: Tx | PrismaService, u: AuthUser, orderId: string) {
    const o = await db.order.findUnique({ where: { id: orderId } });
    if (!o || o.farmerId !== u.id) throw new NotFoundException('Order not found');
    if (!o.selfCertRequired) throw new ConflictException({ code: 'SELF_CERT_NOT_ACTIVE', message: 'Self-certification only applies when no inspector is available' });
    return o;
  }

  /** The recorder asks for this immediately before recording. The response also syncs the device to server time. */
  async openCaptureSession(u: AuthUser, orderId: string, d: CaptureSessionDto) {
    await this.selfCertOrder(this.prisma, u, orderId);
    const now = this.clock.now();
    const token = this.crypto.randomToken();
    const minutes = await this.config.get('selfCertSessionMinutes');
    const s = await this.prisma.captureSession.create({ data: { orderId, farmerId: u.id, kind: d.kind, tokenHash: this.crypto.sha256(token), startedAt: now, expiresAt: new Date(now.getTime() + minutes * 60_000) } });
    return { sessionId: s.id, captureToken: token, serverTime: now, expiresAt: s.expiresAt, kind: d.kind };
  }

  /** Attaches a recorded clip. Every check is on the server; the device only ever supplies evidence. */
  async addClip(u: AuthUser, orderId: string, d: ClipDto) {
    return this.prisma.tx(async (tx) => {
      const o = await this.selfCertOrder(tx, u, orderId);
      const session = await tx.captureSession.findUnique({ where: { tokenHash: this.crypto.sha256(d.captureToken) } });
      const now = this.clock.now();
      if (!session || session.orderId !== orderId || session.farmerId !== u.id || session.usedAt) throw new ForbiddenException({ code: 'CAPTURE_TOKEN_INVALID', message: 'This recording session is not valid' });
      const f = await this.files.requireCompleted(tx, u.id, d.fileId, ['SELF_CERT_VIDEO']);
      // A file not created through this very session (a gallery upload, or a clip recycled from another session) is refused.
      if (f.captureSessionId !== session.id) throw new ForbiddenException({ code: 'NOT_IN_APP_CAPTURE', message: 'This video was not recorded in this session' });
      if (f.sha256Server !== f.sha256Declared) throw new UnprocessableEntityException({ code: 'HASH_MISMATCH', message: 'Video hash does not match' });
      const capturedAt = new Date(d.capturedAt);
      if (capturedAt < session.startedAt || capturedAt > session.expiresAt || capturedAt > now) throw new UnprocessableEntityException({ code: 'TIMESTAMP_OUT_OF_WINDOW', message: 'Recording time is outside this session' });
      if (o.t0At && o.slaDeadlineAt && (capturedAt < o.t0At || capturedAt > o.slaDeadlineAt)) throw new UnprocessableEntityException({ code: 'TIMESTAMP_OUT_OF_WINDOW', message: 'Recording time is outside the SLA window' });
      const radius = await this.config.get('selfCertRadiusMetres', tx);
      const pickup = { lat: o.pickupLat, lng: o.pickupLng };
      const metres = haversineMetres({ lat: d.lat, lng: d.lng }, pickup);
      if (metres > radius) throw new UnprocessableEntityException({ code: 'OUTSIDE_RADIUS', message: `Recorded ${metres} m from the farm; must be within ${radius} m`, metres, radius });
      const capture = { lat: d.lat, lng: d.lng, metres, capturedAt, durationSec: d.durationSec, source: d.source, sha256: f.sha256Server, sessionId: session.id } as unknown as Prisma.InputJsonValue;
      await tx.captureSession.update({ where: { id: session.id }, data: { usedAt: now } });
      const fields = session.kind === 'SCALE' ? { scaleVideoFileId: d.fileId, scaleCapture: capture } : { vehicleVideoFileId: d.fileId, vehicleCapture: capture };
      return tx.selfCertification.upsert({ where: { orderId }, create: { orderId, ...fields }, update: fields });
    });
  }

  async submitSelfCert(u: AuthUser, orderId: string, d: SubmitSelfCertDto) {
    return this.prisma.tx(async (tx) => {
      const o = await this.selfCertOrder(tx, u, orderId);
      const sc = await tx.selfCertification.findUnique({ where: { orderId } });
      if (!sc?.scaleVideoFileId || !sc.vehicleVideoFileId) throw new UnprocessableEntityException({ code: 'VIDEOS_REQUIRED', message: 'Both the scale and the loaded-vehicle videos are required' });
      if (o.state !== 'INSPECTION_SCHEDULED') throw new ConflictException({ code: 'GUARD_FAILED', message: 'The buyer has not fully funded the order yet' });
      await tx.selfCertification.update({ where: { orderId }, data: { certifiedWeightKg: d.certifiedWeightKg, submittedAt: this.clock.now() } });
      await tx.order.update({ where: { id: orderId }, data: { dispatchedWeightKg: d.certifiedWeightKg } });
      return this.engine.transition(tx, orderId, 'SELF_CERTIFIED', { id: u.id, role: 'FARMER' }, { certifiedWeightKg: d.certifiedWeightKg });
    });
  }
}
