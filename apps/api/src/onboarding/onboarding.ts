/** Files (signed URLs + SHA-256), masters, and all KYC/KYB/degree/vehicle/organic onboarding flows. */
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Inject, Injectable, Module, NotFoundException, Param, Patch, Post, Put, UnprocessableEntityException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FilePurpose, Prisma } from '@prisma/client';
import { ALLOWED_DEGREES, DegreeType, gstinMatchesPan, isValidGstin, namesMatch, pickVehicleTier } from '@agrimate/shared';
import { KYC, KycAdapter, STORAGE, StorageAdapter } from '../adapters/others';
import { AuthUser, CurrentUser, Public, Roles } from '../auth/auth';
import { AuditService, Clock, CONFIG_DEFAULTS, ConfigKey, ConfigService, CryptoService, PrismaService, Tx } from '../core/core';
import { NotificationsService } from '../engine/engine';
import { AvailabilityDto, BuyerKybDto, CommodityDto, ConfigValueDto, ContractTermsDto, FarmerKycDto, GradeDto, InspectionTiersDto, InspectorDegreeDto, LogisticsProfileDto, MultipartCompleteDto, OrganicCertDto, PartDto, UploadUrlDto, VehicleDto, VehicleRateDto, VehicleTierDto } from './onboarding.dto';

// ---- Files ---------------------------------------------------------------------------------------------------------
@Injectable()
export class FilesService {
  constructor(private readonly prisma: PrismaService, private readonly clock: Clock, private readonly crypto: CryptoService, @Inject(STORAGE) private readonly storage: StorageAdapter) {}

  async createUpload(user: AuthUser, dto: UploadUrlDto) {
    let captureSessionId: string | undefined;
    if (dto.purpose === 'SELF_CERT_VIDEO') {
      // There is deliberately no other way to create a self-cert file: no token, no upload.
      if (!dto.captureToken) throw new ForbiddenException({ code: 'CAPTURE_TOKEN_REQUIRED', message: 'Self-certification video can only be recorded in the app' });
      const s = await this.prisma.captureSession.findUnique({ where: { tokenHash: this.crypto.sha256(dto.captureToken) } });
      if (!s || s.farmerId !== user.id || s.expiresAt < this.clock.now() || s.usedAt) throw new ForbiddenException({ code: 'CAPTURE_TOKEN_INVALID', message: 'Recording session is invalid or has expired' });
      captureSessionId = s.id;
      dto.orderId = s.orderId;
    }
    if (dto.orderId) await this.assertOrderParty(user, dto.orderId);
    const id = this.crypto.randomToken(12);
    const key = `${dto.purpose.toLowerCase()}/${user.id}/${id}`;
    const uploadId = dto.multipart ? await this.storage.createMultipart(key, dto.contentType) : undefined;
    const file = await this.prisma.fileObject.create({ data: { ownerId: user.id, purpose: dto.purpose, key, contentType: dto.contentType, sizeBytes: dto.sizeBytes, sha256Declared: dto.sha256, orderId: dto.orderId, captureSessionId, multipartUploadId: uploadId } });
    return { fileId: file.id, uploadUrl: uploadId ? null : await this.storage.signedPutUrl(key, dto.contentType), multipart: !!uploadId, key };
  }
  async partUrl(user: AuthUser, id: string, dto: PartDto) {
    const f = await this.own(user, id);
    if (!f.multipartUploadId) throw new BadRequestException('Not a multipart upload');
    return { url: await this.storage.signedPartUrl(f.key, f.multipartUploadId, dto.partNumber) };
  }
  async completeMultipart(user: AuthUser, id: string, dto: MultipartCompleteDto) {
    const f = await this.own(user, id);
    if (!f.multipartUploadId) throw new BadRequestException('Not a multipart upload');
    await this.storage.completeMultipart(f.key, f.multipartUploadId, dto.parts);
    return this.complete(user, id);
  }
  /** Re-hashes the stored bytes. A mismatch means corruption or tampering between the device and storage. */
  async complete(user: AuthUser, id: string) {
    const f = await this.own(user, id);
    const stored = await this.storage.hashObject(f.key);
    if (!stored) throw new ConflictException({ code: 'FILE_NOT_UPLOADED', message: 'File bytes have not arrived yet' });
    if (stored.sha256 !== f.sha256Declared) throw new UnprocessableEntityException({ code: 'HASH_MISMATCH', message: 'File hash does not match what the device declared' });
    const u = await this.prisma.fileObject.update({ where: { id }, data: { sha256Server: stored.sha256, sizeBytes: stored.size, completedAt: this.clock.now() } });
    return { fileId: u.id, sha256: u.sha256Server, completedAt: u.completedAt };
  }
  async downloadUrl(user: AuthUser, id: string) {
    const f = await this.prisma.fileObject.findUnique({ where: { id } });
    if (!f) throw new NotFoundException('File not found');
    const allowed = user.role === 'ADMIN' || f.ownerId === user.id || (f.orderId ? await this.isOrderParty(user, f.orderId) : false);
    if (!allowed) throw new ForbiddenException('No access to this file');
    return { url: await this.storage.signedGetUrl(f.key), sha256: f.sha256Server, contentType: f.contentType };
  }
  /** For other services: returns the file only if it is this user's, for this purpose, and fully verified. */
  async requireCompleted(db: Tx | PrismaService, ownerId: string, fileId: string, purposes: FilePurpose[]) {
    const f = await db.fileObject.findUnique({ where: { id: fileId } });
    if (!f || f.ownerId !== ownerId) throw new UnprocessableEntityException({ code: 'FILE_NOT_FOUND', message: `File ${fileId} not found` });
    if (!purposes.includes(f.purpose)) throw new UnprocessableEntityException({ code: 'FILE_WRONG_PURPOSE', message: `File must be one of: ${purposes.join(', ')}` });
    if (!f.completedAt) throw new UnprocessableEntityException({ code: 'FILE_NOT_COMPLETE', message: 'File upload was not completed' });
    return f;
  }
  private async own(user: AuthUser, id: string) {
    const f = await this.prisma.fileObject.findUnique({ where: { id } });
    if (!f || f.ownerId !== user.id) throw new NotFoundException('File not found');
    return f;
  }
  private async isOrderParty(user: AuthUser, orderId: string) {
    const o = await this.prisma.order.findUnique({ where: { id: orderId }, include: { inspection: true, trip: true } });
    if (!o) return false;
    return o.buyerId === user.id || o.farmerId === user.id || o.inspection?.inspectorId === user.id || o.trip?.partnerId === user.id || user.role === 'ADMIN';
  }
  private async assertOrderParty(user: AuthUser, orderId: string) {
    if (!(await this.isOrderParty(user, orderId))) throw new ForbiddenException('Not a party to this order');
  }
}

@ApiTags('files') @ApiBearerAuth() @Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}
  @Post('upload-url') upload(@CurrentUser() u: AuthUser, @Body() d: UploadUrlDto) { return this.files.createUpload(u, d); }
  @Post(':id/parts') part(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: PartDto) { return this.files.partUrl(u, id, d); }
  @Post(':id/multipart-complete') mpc(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: MultipartCompleteDto) { return this.files.completeMultipart(u, id, d); }
  @Post(':id/complete') complete(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.files.complete(u, id); }
  @Get(':id/download-url') download(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.files.downloadUrl(u, id); }
}

// ---- Masters -------------------------------------------------------------------------------------------------------
@ApiTags('masters') @Controller('masters')
export class MastersController {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, private readonly audit: AuditService) {}
  private log(u: AuthUser, action: string, entity: string, entityId: string | null, data?: unknown) { return this.audit.log({ actorId: u.id, actorRole: u.role, action, entity, entityId, data }); }

  @Public() @Get('commodities')
  commodities() { return this.prisma.commodity.findMany({ where: { active: true }, include: { grades: { where: { active: true }, orderBy: { code: 'asc' } } }, orderBy: { name: 'asc' } }); }
  @Public() @Get('vehicle-tiers')
  tiers() { return this.prisma.vehicleTier.findMany({ where: { active: true }, orderBy: { maxKg: 'asc' } }); }
  @Public() @Get('inspection-tiers')
  async inspectionTiers() {
    const rows = await this.prisma.inspectionFeeTier.findMany();
    return rows.sort((a, b) => (a.maxKgInclusive ?? Infinity) - (b.maxKgInclusive ?? Infinity));
  }
  @Public() @Get('contract-terms/active')
  contract() { return this.prisma.contractTerms.findFirst({ where: { active: true } }); }
  @Public() @Get('pincodes/:pin')
  async pin(@Param('pin') pin: string) {
    const p = await this.prisma.pinCode.findUnique({ where: { pin } });
    if (!p) throw new NotFoundException('PIN not in master');
    return p;
  }
  @ApiBearerAuth() @Get('config')
  cfg() { return this.config.all(); }

  @ApiBearerAuth() @Roles('ADMIN') @Post('commodities')
  async addCommodity(@CurrentUser() u: AuthUser, @Body() d: CommodityDto) {
    const c = await this.prisma.commodity.create({ data: d });
    await this.log(u, 'COMMODITY_CREATED', 'Commodity', c.id, d);
    return c;
  }
  @ApiBearerAuth() @Roles('ADMIN') @Post('commodities/:id/grades')
  async addGrade(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: GradeDto) {
    const g = await this.prisma.grade.create({ data: { commodityId: id, code: d.code, name: d.name, parameters: d.parameters as unknown as Prisma.InputJsonValue } });
    await this.log(u, 'GRADE_CREATED', 'Grade', g.id, d);
    return g;
  }
  @ApiBearerAuth() @Roles('ADMIN') @Put('grades/:id')
  async putGrade(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: GradeDto) {
    const g = await this.prisma.grade.update({ where: { id }, data: { code: d.code, name: d.name, parameters: d.parameters as unknown as Prisma.InputJsonValue } });
    await this.log(u, 'GRADE_UPDATED', 'Grade', id, d);
    return g;
  }
  @ApiBearerAuth() @Roles('ADMIN') @Post('vehicle-tiers')
  async addTier(@CurrentUser() u: AuthUser, @Body() d: VehicleTierDto) {
    const t = await this.prisma.vehicleTier.create({ data: { ...d, ratePaisePerKm: BigInt(d.ratePaisePerKm) } });
    await this.log(u, 'VEHICLE_TIER_CREATED', 'VehicleTier', t.id, d);
    return t;
  }
  @ApiBearerAuth() @Roles('ADMIN') @Patch('vehicle-tiers/:id')
  async patchTier(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: VehicleRateDto) {
    const t = await this.prisma.vehicleTier.update({ where: { id }, data: { ratePaisePerKm: BigInt(d.ratePaisePerKm) } });
    await this.log(u, 'VEHICLE_RATE_UPDATED', 'VehicleTier', id, d);
    return t;
  }
  @ApiBearerAuth() @Roles('ADMIN') @Put('inspection-tiers')
  async putInspectionTiers(@CurrentUser() u: AuthUser, @Body() d: InspectionTiersDto) {
    // Exactly one open-ended tier, or some payload would have no fee.
    if (d.tiers.filter((t) => t.maxKgInclusive == null).length !== 1) throw new BadRequestException('Exactly one tier must be open-ended');
    await this.prisma.$transaction([
      this.prisma.inspectionFeeTier.deleteMany(),
      this.prisma.inspectionFeeTier.createMany({ data: d.tiers.map((t) => ({ maxKgInclusive: t.maxKgInclusive ?? null, feePaise: BigInt(t.feePaise) })) }),
    ]);
    await this.log(u, 'INSPECTION_TIERS_UPDATED', 'InspectionFeeTier', null, d);
    return this.inspectionTiers();
  }
  @ApiBearerAuth() @Roles('ADMIN') @Put('config/:key')
  async putConfig(@CurrentUser() u: AuthUser, @Param('key') key: string, @Body() d: ConfigValueDto) {
    if (!(key in CONFIG_DEFAULTS)) throw new NotFoundException('Unknown config key');
    if (typeof d.value !== typeof CONFIG_DEFAULTS[key as ConfigKey]) throw new BadRequestException(`${key} must be a ${typeof CONFIG_DEFAULTS[key as ConfigKey]}`);
    await this.config.set(key as ConfigKey, d.value, u.id);
    await this.log(u, 'CONFIG_UPDATED', 'PlatformConfig', key, { value: d.value });
    return this.config.all();
  }
  @ApiBearerAuth() @Roles('ADMIN') @Post('contract-terms')
  async addTerms(@CurrentUser() u: AuthUser, @Body() d: ContractTermsDto) {
    const [, c] = await this.prisma.$transaction([this.prisma.contractTerms.updateMany({ data: { active: false } }), this.prisma.contractTerms.create({ data: { ...d, active: true } })]);
    await this.log(u, 'CONTRACT_TERMS_PUBLISHED', 'ContractTerms', c.id, { version: d.version });
    return c;
  }
}

// ---- Onboarding ----------------------------------------------------------------------------------------------------
@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService, private readonly crypto: CryptoService, private readonly clock: Clock, private readonly files: FilesService, private readonly notifications: NotificationsService, @Inject(KYC) private readonly kyc: KycAdapter) {}

  private async pinGeo(pin: string, lat?: number, lng?: number) {
    const p = await this.prisma.pinCode.findUnique({ where: { pin } });
    if (lat !== undefined && lng !== undefined) return { lat, lng, district: p?.district, state: p?.state };
    if (!p) throw new BadRequestException({ code: 'PIN_UNKNOWN', message: 'PIN is not in the master; send lat and lng as well' });
    return { lat: p.lat, lng: p.lng, district: p.district, state: p.state };
  }

  async buyerKyb(u: AuthUser, d: BuyerKybDto) {
    if (!isValidGstin(d.gstin)) throw new UnprocessableEntityException({ code: 'GSTIN_INVALID', message: 'GSTIN checksum is wrong' });
    if (!gstinMatchesPan(d.gstin, d.pan)) throw new UnprocessableEntityException({ code: 'GSTIN_PAN_MISMATCH', message: 'This PAN does not belong to this GSTIN' });
    const [pan, gst] = await Promise.all([this.kyc.verifyPan(d.pan, d.companyName), this.kyc.verifyGstin(d.gstin)]);
    const ok = pan.valid && gst.valid && gst.active !== false;
    return this.prisma.buyerProfile.update({
      where: { userId: u.id },
      data: { companyName: d.companyName, gstin: d.gstin, panEnc: this.crypto.encrypt(d.pan), panLast4: d.pan.slice(-4), defaultPin: d.defaultPin, kybStatus: ok ? 'VERIFIED' : 'MANUAL_REVIEW', kybResponse: JSON.parse(JSON.stringify({ pan: pan.raw, gst: gst.raw })), kybNote: ok ? null : 'Automatic verification failed' },
      select: { companyName: true, gstin: true, kybStatus: true, kybNote: true },
    });
  }

  /** Hard rule: payouts stay off unless the name the BANK reports matches the PAN name. */
  async farmerKyc(u: AuthUser, d: FarmerKycDto) {
    const geo = await this.pinGeo(d.pin, d.lat, d.lng);
    const pan = await this.kyc.verifyPan(d.pan, d.panName);
    const panName = pan.registeredName ?? d.panName;
    const bank = pan.valid ? await this.kyc.verifyBank({ accountNumber: d.bankAccount, ifsc: d.ifsc, declaredName: d.bankHolderName }) : null;
    const holder = bank?.holderName ?? d.bankHolderName;
    const nameOk = !!bank?.valid && namesMatch(holder, panName);
    const status = !pan.valid ? 'REJECTED' : nameOk ? 'VERIFIED' : 'MANUAL_REVIEW';
    const note = !pan.valid ? 'PAN could not be verified' : !bank?.valid ? 'Bank account could not be verified' : nameOk ? null : `Bank holder name "${holder}" does not match PAN name "${panName}"`;
    return this.prisma.farmerProfile.update({
      where: { userId: u.id },
      data: {
        type: d.type ?? 'INDIVIDUAL', fpoName: d.fpoName, panEnc: this.crypto.encrypt(d.pan), panLast4: d.pan.slice(-4), panName,
        bankAccountEnc: this.crypto.encrypt(d.bankAccount), bankLast4: d.bankAccount.slice(-4), bankIfsc: d.ifsc, bankHolderName: holder,
        kycStatus: status, kycNote: note, kycResponse: JSON.parse(JSON.stringify({ pan: pan.raw, bank: bank?.raw ?? null })),
        payoutsEnabled: status === 'VERIFIED', fundAccountId: bank?.fundAccountId ?? null,
        pin: d.pin, lat: geo.lat, lng: geo.lng, district: geo.district, state: geo.state,
      },
      select: { kycStatus: true, kycNote: true, payoutsEnabled: true, bankLast4: true, panLast4: true },
    });
  }

  private async fundAccount(name: string, account?: string, ifsc?: string) {
    if (!account || !ifsc) return undefined;
    const r = await this.kyc.verifyBank({ accountNumber: account, ifsc, declaredName: name });
    return r.valid ? r.fundAccountId : undefined;
  }

  async inspectorDegree(u: AuthUser, d: InspectorDegreeDto) {
    // PRD: Animal Husbandry and Veterinary degrees are explicitly excluded.
    if (!ALLOWED_DEGREES.includes(d.degreeType as DegreeType)) throw new UnprocessableEntityException({ code: 'DEGREE_NOT_ELIGIBLE', message: 'Only B.Sc or M.Sc Agriculture degrees are accepted' });
    await this.files.requireCompleted(this.prisma, u.id, d.degreeFileId, ['DEGREE_CERT']);
    const geo = await this.pinGeo(d.pin, d.lat, d.lng);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    return this.prisma.inspectorProfile.update({
      where: { userId: u.id },
      data: { degreeType: d.degreeType, degreeFileId: d.degreeFileId, status: 'PENDING', statusNote: null, pin: d.pin, lat: geo.lat, lng: geo.lng, serviceRadiusKm: d.serviceRadiusKm ?? 50, available: false, fundAccountId: await this.fundAccount(user.name, d.bankAccount, d.ifsc) },
      select: { status: true, degreeType: true, serviceRadiusKm: true },
    });
  }

  async availability(u: AuthUser, d: AvailabilityDto) {
    const p = await this.prisma.inspectorProfile.findUniqueOrThrow({ where: { userId: u.id } });
    if (d.available && p.status !== 'VERIFIED') throw new ForbiddenException({ code: 'INSPECTOR_NOT_APPROVED', message: 'An admin has to approve your degree first' });
    return this.prisma.inspectorProfile.update({ where: { userId: u.id }, data: d, select: { available: true, serviceRadiusKm: true, lat: true, lng: true } });
  }

  async logisticsProfile(u: AuthUser, d: LogisticsProfileDto) {
    if (!d.noCoLoadingAccepted) throw new UnprocessableEntityException({ code: 'NO_CO_LOADING_REQUIRED', message: 'You must accept the no co-loading term' });
    if (d.partnerType === 'AGENCY' && !d.gstin) throw new UnprocessableEntityException({ code: 'GSTIN_REQUIRED', message: 'Agencies must provide a GSTIN' });
    if (d.gstin && !isValidGstin(d.gstin)) throw new UnprocessableEntityException({ code: 'GSTIN_INVALID', message: 'GSTIN checksum is wrong' });
    await this.files.requireCompleted(this.prisma, u.id, d.rcFileId, ['RC']);
    await this.files.requireCompleted(this.prisma, u.id, d.dlFileId, ['DRIVING_LICENCE']);
    await this.files.requireCompleted(this.prisma, u.id, d.fitnessFileId, ['FITNESS_CERT']);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    return this.prisma.logisticsProfile.update({
      where: { userId: u.id },
      data: { partnerType: d.partnerType, companyName: d.companyName, gstin: d.gstin, rcFileId: d.rcFileId, dlFileId: d.dlFileId, fitnessFileId: d.fitnessFileId, status: 'PENDING', noCoLoadingAcceptedAt: this.clock.now(), fundAccountId: await this.fundAccount(user.name, d.bankAccount, d.ifsc) },
      select: { status: true, partnerType: true, noCoLoadingAcceptedAt: true },
    });
  }

  async addVehicle(u: AuthUser, d: VehicleDto) {
    const tiers = await this.prisma.vehicleTier.findMany({ where: { active: true } });
    let tier;
    try { tier = pickVehicleTier(d.capacityKg, tiers); } catch { throw new UnprocessableEntityException({ code: 'NO_TIER', message: 'No vehicle tier covers this capacity' }); }
    return this.prisma.vehicle.create({ data: { partnerId: u.id, regNo: d.regNo, capacityKg: d.capacityKg, tierId: tier.id }, include: { tier: true } });
  }
  listVehicles(u: AuthUser) { return this.prisma.vehicle.findMany({ where: { partnerId: u.id, active: true }, include: { tier: true } }); }

  async addOrganicCert(u: AuthUser, d: OrganicCertDto) {
    await this.files.requireCompleted(this.prisma, u.id, d.fileId, ['ORGANIC_CERT']);
    const expiresAt = new Date(d.expiresAt);
    if (expiresAt <= this.clock.now()) throw new UnprocessableEntityException({ code: 'CERT_EXPIRED', message: 'This certificate has already expired' });
    return this.prisma.organicCertificate.create({ data: { farmerId: u.id, fileId: d.fileId, certifier: d.certifier, certNumber: d.certNumber, expiresAt } });
  }
  listOrganicCerts(u: AuthUser) { return this.prisma.organicCertificate.findMany({ where: { farmerId: u.id }, orderBy: { createdAt: 'desc' } }); }
}

@ApiTags('onboarding') @ApiBearerAuth() @Controller('onboarding')
export class OnboardingController {
  constructor(private readonly s: OnboardingService) {}
  @Roles('BUYER') @Post('buyer/kyb') kyb(@CurrentUser() u: AuthUser, @Body() d: BuyerKybDto) { return this.s.buyerKyb(u, d); }
  @Roles('FARMER') @Post('farmer/kyc') kyc(@CurrentUser() u: AuthUser, @Body() d: FarmerKycDto) { return this.s.farmerKyc(u, d); }
  @Roles('INSPECTOR') @Post('inspector/degree') degree(@CurrentUser() u: AuthUser, @Body() d: InspectorDegreeDto) { return this.s.inspectorDegree(u, d); }
  @Roles('INSPECTOR') @Post('inspector/availability') avail(@CurrentUser() u: AuthUser, @Body() d: AvailabilityDto) { return this.s.availability(u, d); }
  @Roles('LOGISTICS') @Post('logistics/profile') logi(@CurrentUser() u: AuthUser, @Body() d: LogisticsProfileDto) { return this.s.logisticsProfile(u, d); }
  @Roles('LOGISTICS') @Post('logistics/vehicles') addV(@CurrentUser() u: AuthUser, @Body() d: VehicleDto) { return this.s.addVehicle(u, d); }
  @Roles('LOGISTICS') @Get('logistics/vehicles') listV(@CurrentUser() u: AuthUser) { return this.s.listVehicles(u); }
  @Roles('FARMER') @Post('organic-certs') addC(@CurrentUser() u: AuthUser, @Body() d: OrganicCertDto) { return this.s.addOrganicCert(u, d); }
  @Roles('FARMER') @Get('organic-certs') listC(@CurrentUser() u: AuthUser) { return this.s.listOrganicCerts(u); }
}

@Module({ providers: [FilesService, OnboardingService], controllers: [FilesController, MastersController, OnboardingController], exports: [FilesService] })
export class OnboardingModule {}
