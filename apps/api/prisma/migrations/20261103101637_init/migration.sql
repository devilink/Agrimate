-- CreateEnum
CREATE TYPE "Role" AS ENUM ('BUYER', 'FARMER', 'INSPECTOR', 'LOGISTICS', 'ADMIN');

-- CreateEnum
CREATE TYPE "OrderState" AS ENUM ('MATCHED', 'AWAITING_ADVANCE', 'ADVANCE_LOCKED', 'LOGISTICS_PENDING', 'LOGISTICS_SECURED', 'AWAITING_BALANCE', 'FULLY_FUNDED', 'INSPECTION_SCHEDULED', 'INSPECTED', 'SELF_CERTIFIED', 'IN_TRANSIT', 'DELIVERED', 'DISPUTE_WINDOW', 'SETTLED', 'FARMER_DEFAULTED', 'REFUNDED', 'BUYER_DEFAULTED', 'DISPUTED', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RfqState" AS ENUM ('RFQ_OPEN', 'BIDDING', 'MATCHED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ListingState" AS ENUM ('LISTED', 'MATCHED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "BidState" AS ENUM ('SUBMITTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "OrderFlow" AS ENUM ('RFQ', 'CATALOG');

-- CreateEnum
CREATE TYPE "TrancheKind" AS ENUM ('ADVANCE', 'BALANCE', 'FREIGHT');

-- CreateEnum
CREATE TYPE "TrancheStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID');

-- CreateEnum
CREATE TYPE "LogisticsMode" AS ENUM ('PLATFORM', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'MANUAL_REVIEW', 'REJECTED');

-- CreateEnum
CREATE TYPE "FarmerType" AS ENUM ('INDIVIDUAL', 'FPO');

-- CreateEnum
CREATE TYPE "LogisticsPartnerType" AS ENUM ('INDIVIDUAL', 'AGENCY');

-- CreateEnum
CREATE TYPE "DegreeType" AS ENUM ('BSC_AGRICULTURE', 'MSC_AGRICULTURE', 'BSC_ANIMAL_HUSBANDRY', 'MSC_ANIMAL_HUSBANDRY', 'VETERINARY');

-- CreateEnum
CREATE TYPE "FilePurpose" AS ENUM ('KYC_DOC', 'DEGREE_CERT', 'RC', 'DRIVING_LICENCE', 'FITNESS_CERT', 'ORGANIC_CERT', 'DISPATCH_PHOTO', 'INSPECTION_PHOTO', 'SELF_CERT_VIDEO', 'EWAY_BILL', 'POD_PHOTO', 'POD_SIGNATURE', 'DISPUTE_EVIDENCE', 'SPOT_TEST_REPORT');

-- CreateEnum
CREATE TYPE "DisputeType" AS ENUM ('WEIGHT', 'QUALITY');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "DisputeOutcome" AS ENUM ('RELEASE_TO_FARMER', 'PARTIAL_REFUND', 'FULL_REFUND_FARMER_FAULT');

-- CreateEnum
CREATE TYPE "SpotTestStatus" AS ENUM ('REQUESTED', 'PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('UNASSIGNED', 'ASSIGNED', 'CHECKED_IN', 'INSPECTED', 'FAILED_GRADE', 'WAIVED_SELF_CERT');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('OPEN', 'ACCEPTED', 'PICKED_UP', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('BLOCKED', 'PENDING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "PayeeType" AS ENUM ('FARMER', 'LOGISTICS', 'INSPECTOR');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('BUYER_INVOICE', 'FARMER_STATEMENT', 'LOGISTICS_PAYOUT');

-- CreateEnum
CREATE TYPE "SlaTimerKind" AS ENUM ('REMINDER_T24', 'REMINDER_T6', 'REMINDER_T1', 'SLA_BREACH', 'INSPECTOR_RETRY', 'SELF_CERT_FALLBACK', 'DISPUTE_WINDOW_END');

-- CreateEnum
CREATE TYPE "TimerStatus" AS ENUM ('PENDING', 'FIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AlertKind" AS ENUM ('UNDERPAYMENT', 'OVERPAYMENT', 'UNMATCHED_PAYMENT', 'BUYER_DEFAULT', 'SLA_BREACH', 'INSPECTION_FAILED', 'INSPECTOR_ESCALATION', 'RECONCILIATION_MISMATCH', 'PAYOUT_FAILED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "name" TEXT NOT NULL,
    "phoneEnc" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "phoneLast4" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpChallenge" (
    "id" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerProfile" (
    "userId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "gstin" TEXT,
    "panEnc" TEXT,
    "panLast4" TEXT,
    "kybStatus" "VerificationStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "kybResponse" JSONB,
    "kybNote" TEXT,
    "defaultPin" TEXT,

    CONSTRAINT "BuyerProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "FarmerProfile" (
    "userId" TEXT NOT NULL,
    "type" "FarmerType" NOT NULL DEFAULT 'INDIVIDUAL',
    "fpoName" TEXT,
    "panEnc" TEXT,
    "panLast4" TEXT,
    "panName" TEXT,
    "bankAccountEnc" TEXT,
    "bankLast4" TEXT,
    "bankIfsc" TEXT,
    "bankHolderName" TEXT,
    "kycStatus" "VerificationStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "kycResponse" JSONB,
    "kycNote" TEXT,
    "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "fundAccountId" TEXT,
    "pin" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "district" TEXT,
    "state" TEXT,

    CONSTRAINT "FarmerProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "InspectorProfile" (
    "userId" TEXT NOT NULL,
    "degreeType" "DegreeType",
    "degreeFileId" TEXT,
    "status" "VerificationStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "statusNote" TEXT,
    "available" BOOLEAN NOT NULL DEFAULT false,
    "serviceRadiusKm" INTEGER NOT NULL DEFAULT 50,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "pin" TEXT,
    "fundAccountId" TEXT,

    CONSTRAINT "InspectorProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "LogisticsProfile" (
    "userId" TEXT NOT NULL,
    "partnerType" "LogisticsPartnerType" NOT NULL DEFAULT 'INDIVIDUAL',
    "companyName" TEXT,
    "gstin" TEXT,
    "rcFileId" TEXT,
    "dlFileId" TEXT,
    "fitnessFileId" TEXT,
    "status" "VerificationStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "statusNote" TEXT,
    "noCoLoadingAcceptedAt" TIMESTAMP(3),
    "fundAccountId" TEXT,

    CONSTRAINT "LogisticsProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "tierId" TEXT NOT NULL,
    "regNo" TEXT NOT NULL,
    "capacityKg" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commodity" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "names" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Commodity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Grade" (
    "id" TEXT NOT NULL,
    "commodityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Grade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleTier" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minKg" INTEGER NOT NULL,
    "maxKg" INTEGER NOT NULL,
    "ratePaisePerKm" BIGINT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "VehicleTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionFeeTier" (
    "id" TEXT NOT NULL,
    "maxKgInclusive" INTEGER,
    "feePaise" BIGINT NOT NULL,

    CONSTRAINT "InspectionFeeTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformConfig" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "PlatformConfig_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ContractTerms" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractTerms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PinCode" (
    "pin" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "PinCode_pkey" PRIMARY KEY ("pin")
);

-- CreateTable
CREATE TABLE "DistanceCache" (
    "id" TEXT NOT NULL,
    "originPin" TEXT NOT NULL,
    "destPin" TEXT NOT NULL,
    "metres" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DistanceCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileObject" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "purpose" "FilePurpose" NOT NULL,
    "key" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "sha256Declared" TEXT NOT NULL,
    "sha256Server" TEXT,
    "completedAt" TIMESTAMP(3),
    "multipartUploadId" TEXT,
    "orderId" TEXT,
    "captureSessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganicCertificate" (
    "id" TEXT NOT NULL,
    "farmerId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "certifier" TEXT NOT NULL,
    "certNumber" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganicCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rfq" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "commodityId" TEXT NOT NULL,
    "gradeId" TEXT NOT NULL,
    "quantityKg" INTEGER NOT NULL,
    "deliveryPin" TEXT NOT NULL,
    "neededBy" TIMESTAMP(3) NOT NULL,
    "suggestedPricePaisePerKg" BIGINT,
    "targetPricePaisePerKg" BIGINT NOT NULL,
    "organicRequired" BOOLEAN NOT NULL DEFAULT false,
    "state" "RfqState" NOT NULL DEFAULT 'RFQ_OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rfq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bid" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "farmerId" TEXT NOT NULL,
    "quantityKg" INTEGER NOT NULL,
    "pricePaisePerKg" BIGINT NOT NULL,
    "state" "BidState" NOT NULL DEFAULT 'SUBMITTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "farmerId" TEXT NOT NULL,
    "commodityId" TEXT NOT NULL,
    "gradeId" TEXT NOT NULL,
    "quantityKg" INTEGER NOT NULL,
    "pricePaisePerKg" BIGINT NOT NULL,
    "pickupPin" TEXT NOT NULL,
    "organicCertId" TEXT,
    "state" "ListingState" NOT NULL DEFAULT 'LISTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "flow" "OrderFlow" NOT NULL,
    "state" "OrderState" NOT NULL DEFAULT 'MATCHED',
    "buyerId" TEXT NOT NULL,
    "farmerId" TEXT NOT NULL,
    "rfqId" TEXT,
    "listingId" TEXT,
    "commodityId" TEXT NOT NULL,
    "gradeId" TEXT NOT NULL,
    "isOrganic" BOOLEAN NOT NULL DEFAULT false,
    "quantityKg" INTEGER NOT NULL,
    "pricePaisePerKg" BIGINT NOT NULL,
    "gmvPaise" BIGINT NOT NULL,
    "advanceBps" INTEGER NOT NULL,
    "commissionBps" INTEGER NOT NULL,
    "freightMarkupBps" INTEGER NOT NULL,
    "inspectionFeePaise" BIGINT NOT NULL,
    "inspectionFeePayer" TEXT NOT NULL DEFAULT 'FARMER',
    "slaDays" INTEGER NOT NULL,
    "disputeWindowHours" INTEGER NOT NULL,
    "pickupPin" TEXT NOT NULL,
    "pickupLat" DOUBLE PRECISION NOT NULL,
    "pickupLng" DOUBLE PRECISION NOT NULL,
    "deliveryPin" TEXT NOT NULL,
    "neededBy" TIMESTAMP(3),
    "contractTermsId" TEXT NOT NULL,
    "contractAcceptedAt" TIMESTAMP(3),
    "t0At" TIMESTAMP(3),
    "slaDeadlineAt" TIMESTAMP(3),
    "inspectionDayAt" TIMESTAMP(3),
    "logisticsMode" "LogisticsMode",
    "externalVehicleNo" TEXT,
    "externalDriverPhoneEnc" TEXT,
    "selfCertRequired" BOOLEAN NOT NULL DEFAULT false,
    "dispatchedWeightKg" INTEGER,
    "receivedWeightKg" INTEGER,
    "deliveredAt" TIMESTAMP(3),
    "disputeDeadlineAt" TIMESTAMP(3),
    "buyerRefundPaise" BIGINT NOT NULL DEFAULT 0,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" TEXT NOT NULL,
    "from" "OrderState",
    "to" "OrderState" NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchPhoto" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DispatchPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VirtualAccount" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "gatewayId" TEXT NOT NULL,
    "ifsc" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "beneficiary" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VirtualAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tranche" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" "TrancheKind" NOT NULL,
    "expectedPaise" BIGINT NOT NULL,
    "receivedPaise" BIGINT NOT NULL DEFAULT 0,
    "status" "TrancheStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tranche_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GatewayPayment" (
    "id" TEXT NOT NULL,
    "virtualAccountId" TEXT,
    "gatewayPaymentId" TEXT NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "feePaise" BIGINT NOT NULL DEFAULT 0,
    "refundedPaise" BIGINT NOT NULL DEFAULT 0,
    "excessPaise" BIGINT NOT NULL DEFAULT 0,
    "payerBankRef" TEXT,
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GatewayPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "gatewayPaymentId" TEXT NOT NULL,
    "gatewayRefundId" TEXT NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "payeeType" "PayeeType" NOT NULL,
    "payeeId" TEXT NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "status" "PayoutStatus" NOT NULL,
    "statusNote" TEXT,
    "gatewayTransferId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "InvoiceType" NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "orderId" TEXT,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerPosting" (
    "id" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerPosting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationReport" (
    "id" TEXT NOT NULL,
    "forDate" TEXT NOT NULL,
    "ledgerInPaise" BIGINT NOT NULL,
    "gatewayInPaise" BIGINT NOT NULL,
    "ledgerOutPaise" BIGINT NOT NULL,
    "gatewayOutPaise" BIGINT NOT NULL,
    "matched" BOOLEAN NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MockGatewayTxn" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "feePaise" BIGINT NOT NULL DEFAULT 0,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MockGatewayTxn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaTimer" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" "SlaTimerKind" NOT NULL,
    "fireAt" TIMESTAMP(3) NOT NULL,
    "status" "TimerStatus" NOT NULL DEFAULT 'PENDING',
    "firedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlaTimer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAlert" (
    "id" TEXT NOT NULL,
    "kind" "AlertKind" NOT NULL,
    "orderId" TEXT,
    "message" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inspection" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "inspectorId" TEXT,
    "status" "InspectionStatus" NOT NULL DEFAULT 'UNASSIGNED',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "assignAttempts" INTEGER NOT NULL DEFAULT 0,
    "checkInAt" TIMESTAMP(3),
    "checkInLat" DOUBLE PRECISION,
    "checkInLng" DOUBLE PRECISION,
    "checkInMetres" INTEGER,
    "readings" JSONB,
    "gradeCheck" JSONB,
    "scaleWeightKg" INTEGER,
    "photoFileIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "inspectedAt" TIMESTAMP(3),
    "deviationAcceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptureSession" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "farmerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaptureSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelfCertification" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "scaleVideoFileId" TEXT,
    "vehicleVideoFileId" TEXT,
    "scaleCapture" JSONB,
    "vehicleCapture" JSONB,
    "certifiedWeightKg" INTEGER,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelfCertification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "partnerId" TEXT,
    "vehicleId" TEXT,
    "status" "TripStatus" NOT NULL DEFAULT 'OPEN',
    "fundedAt" TIMESTAMP(3),
    "tierCode" TEXT NOT NULL,
    "distanceMetres" INTEGER NOT NULL,
    "ratePaisePerKm" BIGINT NOT NULL,
    "loadingFeePaise" BIGINT NOT NULL,
    "baseCostPaise" BIGINT NOT NULL,
    "markupPaise" BIGINT NOT NULL,
    "finalFreightPaise" BIGINT NOT NULL,
    "displayPtkmPaise" BIGINT NOT NULL,
    "ewayBillFileId" TEXT,
    "ewayBillNumber" TEXT,
    "noCoLoadingAttestedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "podPhotoFileId" TEXT,
    "podSignatureFileId" TEXT,
    "podLat" DOUBLE PRECISION,
    "podLng" DOUBLE PRECISION,
    "receiverOtpHash" TEXT,
    "podOtpVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "raisedBy" TEXT NOT NULL,
    "type" "DisputeType" NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceFileIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "discrepancyPercent" DOUBLE PRECISION,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "outcome" "DisputeOutcome",
    "refundPaise" BIGINT,
    "resolutionNote" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpotTest" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "status" "SpotTestStatus" NOT NULL DEFAULT 'REQUESTED',
    "reportFileId" TEXT,
    "resultNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpotTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketPrice" (
    "id" TEXT NOT NULL,
    "commodityId" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "district" TEXT,
    "state" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "minPaisePerKg" BIGINT NOT NULL,
    "maxPaisePerKg" BIGINT NOT NULL,
    "modalPaisePerKg" BIGINT NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "MarketPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationOutbox" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "dedupeKey" TEXT,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneHash_key" ON "User"("phoneHash");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "OtpChallenge_phoneHash_createdAt_idx" ON "OtpChallenge"("phoneHash", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_regNo_key" ON "Vehicle"("regNo");

-- CreateIndex
CREATE UNIQUE INDEX "Commodity_code_key" ON "Commodity"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Grade_commodityId_code_key" ON "Grade"("commodityId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleTier_code_key" ON "VehicleTier"("code");

-- CreateIndex
CREATE UNIQUE INDEX "InspectionFeeTier_maxKgInclusive_key" ON "InspectionFeeTier"("maxKgInclusive");

-- CreateIndex
CREATE UNIQUE INDEX "ContractTerms_version_key" ON "ContractTerms"("version");

-- CreateIndex
CREATE UNIQUE INDEX "DistanceCache_originPin_destPin_key" ON "DistanceCache"("originPin", "destPin");

-- CreateIndex
CREATE UNIQUE INDEX "FileObject_key_key" ON "FileObject"("key");

-- CreateIndex
CREATE INDEX "FileObject_ownerId_idx" ON "FileObject"("ownerId");

-- CreateIndex
CREATE INDEX "FileObject_orderId_idx" ON "FileObject"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Rfq_code_key" ON "Rfq"("code");

-- CreateIndex
CREATE INDEX "Rfq_state_idx" ON "Rfq"("state");

-- CreateIndex
CREATE INDEX "Rfq_buyerId_idx" ON "Rfq"("buyerId");

-- CreateIndex
CREATE UNIQUE INDEX "Bid_rfqId_farmerId_key" ON "Bid"("rfqId", "farmerId");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_code_key" ON "Listing"("code");

-- CreateIndex
CREATE INDEX "Listing_state_idx" ON "Listing"("state");

-- CreateIndex
CREATE UNIQUE INDEX "Order_code_key" ON "Order"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Order_rfqId_key" ON "Order"("rfqId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_listingId_key" ON "Order"("listingId");

-- CreateIndex
CREATE INDEX "Order_buyerId_state_idx" ON "Order"("buyerId", "state");

-- CreateIndex
CREATE INDEX "Order_farmerId_state_idx" ON "Order"("farmerId", "state");

-- CreateIndex
CREATE INDEX "Order_state_idx" ON "Order"("state");

-- CreateIndex
CREATE INDEX "OrderEvent_orderId_createdAt_idx" ON "OrderEvent"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VirtualAccount_orderId_key" ON "VirtualAccount"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "VirtualAccount_gatewayId_key" ON "VirtualAccount"("gatewayId");

-- CreateIndex
CREATE UNIQUE INDEX "Tranche_orderId_kind_key" ON "Tranche"("orderId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "GatewayPayment_gatewayPaymentId_key" ON "GatewayPayment"("gatewayPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_eventId_key" ON "WebhookEvent"("provider", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_gatewayRefundId_key" ON "Refund"("gatewayRefundId");

-- CreateIndex
CREATE INDEX "Refund_orderId_idx" ON "Refund"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_idempotencyKey_key" ON "Payout"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payout_payeeType_payeeId_idx" ON "Payout"("payeeType", "payeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_orderId_type_key" ON "Invoice"("orderId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_code_key" ON "LedgerAccount"("code");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_idempotencyKey_key" ON "JournalEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "JournalEntry_orderId_idx" ON "JournalEntry"("orderId");

-- CreateIndex
CREATE INDEX "LedgerPosting_accountId_idx" ON "LedgerPosting"("accountId");

-- CreateIndex
CREATE INDEX "LedgerPosting_journalId_idx" ON "LedgerPosting"("journalId");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationReport_forDate_key" ON "ReconciliationReport"("forDate");

-- CreateIndex
CREATE UNIQUE INDEX "MockGatewayTxn_ref_key" ON "MockGatewayTxn"("ref");

-- CreateIndex
CREATE INDEX "SlaTimer_status_fireAt_idx" ON "SlaTimer"("status", "fireAt");

-- CreateIndex
CREATE INDEX "SlaTimer_orderId_idx" ON "SlaTimer"("orderId");

-- CreateIndex
CREATE INDEX "AdminAlert_kind_resolvedAt_idx" ON "AdminAlert"("kind", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Inspection_orderId_key" ON "Inspection"("orderId");

-- CreateIndex
CREATE INDEX "Inspection_inspectorId_scheduledFor_idx" ON "Inspection"("inspectorId", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "CaptureSession_tokenHash_key" ON "CaptureSession"("tokenHash");

-- CreateIndex
CREATE INDEX "CaptureSession_orderId_idx" ON "CaptureSession"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "SelfCertification_orderId_key" ON "SelfCertification"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Trip_orderId_key" ON "Trip"("orderId");

-- CreateIndex
CREATE INDEX "Trip_status_idx" ON "Trip"("status");

-- CreateIndex
CREATE INDEX "Dispute_orderId_idx" ON "Dispute"("orderId");

-- CreateIndex
CREATE INDEX "Dispute_status_idx" ON "Dispute"("status");

-- CreateIndex
CREATE INDEX "MarketPrice_commodityId_date_idx" ON "MarketPrice"("commodityId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "MarketPrice_commodityId_market_date_key" ON "MarketPrice"("commodityId", "market", "date");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationOutbox_dedupeKey_key" ON "NotificationOutbox"("dedupeKey");

-- CreateIndex
CREATE INDEX "NotificationOutbox_status_createdAt_idx" ON "NotificationOutbox"("status", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationOutbox_userId_createdAt_idx" ON "NotificationOutbox"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerProfile" ADD CONSTRAINT "BuyerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarmerProfile" ADD CONSTRAINT "FarmerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectorProfile" ADD CONSTRAINT "InspectorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogisticsProfile" ADD CONSTRAINT "LogisticsProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "LogisticsProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "VehicleTier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grade" ADD CONSTRAINT "Grade_commodityId_fkey" FOREIGN KEY ("commodityId") REFERENCES "Commodity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganicCertificate" ADD CONSTRAINT "OrganicCertificate_farmerId_fkey" FOREIGN KEY ("farmerId") REFERENCES "FarmerProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfq" ADD CONSTRAINT "Rfq_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "BuyerProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfq" ADD CONSTRAINT "Rfq_commodityId_fkey" FOREIGN KEY ("commodityId") REFERENCES "Commodity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfq" ADD CONSTRAINT "Rfq_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_farmerId_fkey" FOREIGN KEY ("farmerId") REFERENCES "FarmerProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_farmerId_fkey" FOREIGN KEY ("farmerId") REFERENCES "FarmerProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_commodityId_fkey" FOREIGN KEY ("commodityId") REFERENCES "Commodity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_organicCertId_fkey" FOREIGN KEY ("organicCertId") REFERENCES "OrganicCertificate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "BuyerProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_farmerId_fkey" FOREIGN KEY ("farmerId") REFERENCES "FarmerProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_commodityId_fkey" FOREIGN KEY ("commodityId") REFERENCES "Commodity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_contractTermsId_fkey" FOREIGN KEY ("contractTermsId") REFERENCES "ContractTerms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchPhoto" ADD CONSTRAINT "DispatchPhoto_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualAccount" ADD CONSTRAINT "VirtualAccount_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tranche" ADD CONSTRAINT "Tranche_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatewayPayment" ADD CONSTRAINT "GatewayPayment_virtualAccountId_fkey" FOREIGN KEY ("virtualAccountId") REFERENCES "VirtualAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerPosting" ADD CONSTRAINT "LedgerPosting_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerPosting" ADD CONSTRAINT "LedgerPosting_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaTimer" ADD CONSTRAINT "SlaTimer_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "InspectorProfile"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfCertification" ADD CONSTRAINT "SelfCertification_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "LogisticsProfile"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpotTest" ADD CONSTRAINT "SpotTest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketPrice" ADD CONSTRAINT "MarketPrice_commodityId_fkey" FOREIGN KEY ("commodityId") REFERENCES "Commodity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
