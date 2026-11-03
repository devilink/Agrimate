import { ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsLatitude, IsLongitude, IsNumber, IsObject, IsOptional, IsString, Matches, Min, MinLength } from 'class-validator';
import { DisputeOutcome, DisputeType } from '@prisma/client';

const PIN = /^[1-9][0-9]{5}$/;
const PAISE = /^\d+$/;

export class CreateRfqDto {
  @IsString() commodityId!: string;
  @IsString() gradeId!: string;
  @IsInt() @Min(100) quantityKg!: number;
  @Matches(PIN) deliveryPin!: string;
  @IsDateString() neededBy!: string;
  /** Integer paise per kg. */
  @Matches(PAISE) targetPricePaisePerKg!: string;
  @IsOptional() @IsBoolean() organicRequired?: boolean;
}
export class CreateBidDto {
  @IsInt() @Min(1) quantityKg!: number;
  @Matches(PAISE) pricePaisePerKg!: string;
}
export class CreateListingDto {
  @IsString() commodityId!: string;
  @IsString() gradeId!: string;
  @IsInt() @Min(100) quantityKg!: number;
  @Matches(PAISE) pricePaisePerKg!: string;
  @IsOptional() @Matches(PIN) pickupPin?: string;
  /** Claiming organic requires naming a verified, unexpired certificate. */
  @IsOptional() @IsString() organicCertId?: string;
}
export class AcceptDto {
  /** Must be true: the buyer accepts the active contract terms. */
  @IsBoolean() acceptContract!: boolean;
}
export class AcceptListingDto extends AcceptDto {
  @Matches(PIN) deliveryPin!: string;
}
export class ExternalLogisticsDto {
  @Matches(/^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/) vehicleNo!: string;
  @Matches(/^(\+91)?[6-9][0-9]{9}$/) driverPhone!: string;
}
export class ConfirmDeliveryDto {
  @IsInt() @Min(0) receivedWeightKg!: number;
  @IsOptional() @IsString() podPhotoFileId?: string;
}
export class FileRefDto { @IsString() fileId!: string; }

export class GeoDto {
  @IsLatitude() lat!: number;
  @IsLongitude() lng!: number;
}
export class GradingDto {
  @IsObject() readings!: Record<string, number>;
  @IsInt() @Min(1) scaleWeightKg!: number;
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) photoFileIds!: string[];
}
export class ManualAssignDto { @IsString() inspectorId!: string; }

export class CaptureSessionDto { @IsIn(['SCALE', 'VEHICLE']) kind!: 'SCALE' | 'VEHICLE'; }
export class ClipDto {
  @IsString() captureToken!: string;
  @IsString() fileId!: string;
  @IsLatitude() lat!: number;
  @IsLongitude() lng!: number;
  /** Device time corrected by the server offset from the session response. */
  @IsDateString() capturedAt!: string;
  @IsNumber() @Min(1) durationSec!: number;
  @IsIn(['IN_APP_CAMERA']) source!: 'IN_APP_CAMERA';
}
export class SubmitSelfCertDto { @IsInt() @Min(1) certifiedWeightKg!: number; }

export class AcceptTripDto {
  @IsString() vehicleId!: string;
  /** Must be true for every trip. */
  @IsBoolean() noCoLoadingAttested!: boolean;
}
export class EwayBillDto {
  @IsString() @MinLength(6) ewayBillNumber!: string;
  @IsString() fileId!: string;
}
export class DeliverDto {
  @IsString() podPhotoFileId!: string;
  @IsLatitude() lat!: number;
  @IsLongitude() lng!: number;
  @IsInt() @Min(0) receivedWeightKg!: number;
  @IsOptional() @IsString() receiverOtp?: string;
  @IsOptional() @IsString() signatureFileId?: string;
}

export class CreateDisputeDto {
  @IsEnum(DisputeType) type!: DisputeType;
  @IsString() @MinLength(5) reason!: string;
  @IsArray() @IsString({ each: true }) evidenceFileIds!: string[];
}
export class SpotResultDto {
  @IsBoolean() passed!: boolean;
  @IsString() reportFileId!: string;
  @IsOptional() @IsString() note?: string;
}
export class ResolveDisputeDto {
  @IsEnum(DisputeOutcome) outcome!: DisputeOutcome;
  @IsOptional() @Matches(PAISE) refundPaise?: string;
  @IsString() @MinLength(3) note!: string;
}
export class RefundExcessDto { @IsOptional() @Matches(PAISE) amountPaise?: string; }
export class MockCreditDto {
  /** Rupee-free: integer paise. Omit to pay the next open tranche exactly. */
  @IsOptional() @Matches(PAISE) amountPaise?: string;
  @IsOptional() @IsString() paymentId?: string;
}
export class ReasonDto { @IsString() @MinLength(3) reason!: string; }
