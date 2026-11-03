import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsEnum, IsInt, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, Length, Matches, Max, Min, MinLength, ValidateNested, IsDateString, IsIn, IsDefined } from 'class-validator';
import { DegreeType, FarmerType, FilePurpose, LogisticsPartnerType } from '@prisma/client';

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const PIN = /^[1-9][0-9]{5}$/;

export class BuyerKybDto {
  @IsString() @MinLength(2) companyName!: string;
  @Matches(GSTIN, { message: 'Invalid GSTIN format' }) gstin!: string;
  @Matches(PAN, { message: 'Invalid PAN format' }) pan!: string;
  @IsOptional() @Matches(PIN) defaultPin?: string;
}
export class FarmerKycDto {
  @Matches(PAN, { message: 'Invalid PAN format' }) pan!: string;
  @IsString() @MinLength(2) panName!: string;
  @IsString() @Length(6, 20) bankAccount!: string;
  @Matches(IFSC, { message: 'Invalid IFSC' }) ifsc!: string;
  @IsString() @MinLength(2) bankHolderName!: string;
  @IsOptional() @IsEnum(FarmerType) type?: FarmerType;
  @IsOptional() @IsString() fpoName?: string;
  @Matches(PIN) pin!: string;
  @IsOptional() @IsLatitude() lat?: number;
  @IsOptional() @IsLongitude() lng?: number;
}
export class InspectorDegreeDto {
  @IsEnum(DegreeType) degreeType!: DegreeType;
  @IsString() degreeFileId!: string;
  @Matches(PIN) pin!: string;
  @IsOptional() @IsLatitude() lat?: number;
  @IsOptional() @IsLongitude() lng?: number;
  @IsOptional() @IsInt() @Min(1) @Max(500) serviceRadiusKm?: number;
  @IsOptional() @IsString() bankAccount?: string;
  @IsOptional() @Matches(IFSC) ifsc?: string;
}
export class AvailabilityDto {
  @IsBoolean() available!: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(500) serviceRadiusKm?: number;
  @IsOptional() @IsLatitude() lat?: number;
  @IsOptional() @IsLongitude() lng?: number;
}
export class LogisticsProfileDto {
  @IsEnum(LogisticsPartnerType) partnerType!: LogisticsPartnerType;
  @IsOptional() @IsString() companyName?: string;
  @IsOptional() @Matches(GSTIN) gstin?: string;
  @IsString() rcFileId!: string;
  @IsString() dlFileId!: string;
  @IsString() fitnessFileId!: string;
  /** Must be true: strict ban on carrying other commercial goods with agricultural produce. */
  @IsBoolean() noCoLoadingAccepted!: boolean;
  @IsOptional() @IsString() bankAccount?: string;
  @IsOptional() @Matches(IFSC) ifsc?: string;
}
export class VehicleDto {
  @Matches(/^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/, { message: 'Enter the registration like AS01AB1234' }) regNo!: string;
  @IsInt() @Min(100) capacityKg!: number;
}
export class OrganicCertDto {
  @IsString() fileId!: string;
  @IsString() @MinLength(2) certifier!: string;
  @IsString() @MinLength(2) certNumber!: string;
  @IsDateString() expiresAt!: string;
}
export class ReviewDto {
  @IsIn(['APPROVE', 'REJECT']) decision!: 'APPROVE' | 'REJECT';
  @IsOptional() @IsString() note?: string;
}

// ---- Files ---------------------------------------------------------------------------------------------------------
export class UploadUrlDto {
  @IsEnum(FilePurpose) purpose!: FilePurpose;
  /** Hex SHA-256 computed on the device before upload. */
  @Matches(/^[a-f0-9]{64}$/, { message: 'sha256 must be 64 lowercase hex characters' }) sha256!: string;
  @IsString() contentType!: string;
  @IsOptional() @IsInt() @Min(1) sizeBytes?: number;
  @IsOptional() @IsString() orderId?: string;
  /** Mandatory for SELF_CERT_VIDEO. Issued only by the in-app recorder flow, so gallery files have no way in. */
  @IsOptional() @IsString() captureToken?: string;
  /** Use a resumable multipart upload (recommended for video on poor networks). */
  @IsOptional() @IsBoolean() multipart?: boolean;
}
export class PartDto { @IsInt() @Min(1) @Max(10000) partNumber!: number; }
export class CompletedPart {
  @IsInt() @Min(1) partNumber!: number;
  @IsString() etag!: string;
}
export class MultipartCompleteDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CompletedPart) parts!: CompletedPart[];
}

// ---- Masters -------------------------------------------------------------------------------------------------------
export class GradeParameterDto {
  @Matches(/^[a-z][a-zA-Z0-9_]*$/) key!: string;
  @IsString() label!: string;
  @IsString() unit!: string;
  @IsOptional() @IsNumber() min?: number;
  @IsOptional() @IsNumber() max?: number;
  @IsBoolean() required!: boolean;
}
export class CommodityDto {
  @Matches(/^[A-Z_]+$/) code!: string;
  @IsString() name!: string;
}
export class GradeDto {
  @Matches(/^[A-Z0-9_]+$/) code!: string;
  @IsString() name!: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => GradeParameterDto) parameters!: GradeParameterDto[];
}
export class VehicleTierDto {
  @Matches(/^[A-Z0-9_]+$/) code!: string;
  @IsString() name!: string;
  @IsInt() @Min(0) minKg!: number;
  @IsInt() @Min(1) maxKg!: number;
  /** Paise per km, as an integer string. */
  @Matches(/^\d+$/) ratePaisePerKm!: string;
}
export class VehicleRateDto { @Matches(/^\d+$/) ratePaisePerKm!: string; }
export class InspectionTierDto {
  @IsOptional() @IsInt() @Min(1) maxKgInclusive?: number | null;
  @Matches(/^\d+$/) feePaise!: string;
}
export class InspectionTiersDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => InspectionTierDto) tiers!: InspectionTierDto[];
}
export class ConfigValueDto { @IsDefined() value!: unknown; }
export class ContractTermsDto {
  @IsString() version!: string;
  @IsString() @MinLength(50) body!: string;
}
