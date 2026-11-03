import { Global, Module } from '@nestjs/common';
import { env, PrismaService } from '../core/core';
import { MockPaymentGateway, PAYMENT_GATEWAY, PaymentGateway, RazorpayGateway } from './payments';
import { AgmarknetData, CashfreeKyc, GoogleMaps, KYC, KycAdapter, MAPS, MapsAdapter, MARKET_DATA, MarketDataAdapter, MockKyc, MockMaps, MockMarketData, MockSms, MockStorage, Msg91Sms, S3Storage, SMS, SmsAdapter, SnsSms, STORAGE, StorageAdapter, TwilioSms } from './others';

/** One env var per provider flips it from mock to real; an unknown value fails at boot rather than silently mocking money. */
const choose = <T>(kind: string, value: string, options: Record<string, () => T>): T => {
  const make = options[value];
  if (!make) throw new Error(`Unknown ${kind} provider "${value}". Options: ${Object.keys(options).join(', ')}`);
  return make();
};

@Global()
@Module({
  providers: [
    { provide: PAYMENT_GATEWAY, inject: [PrismaService], useFactory: (p: PrismaService) => choose<PaymentGateway>('payment', env.paymentProvider, { mock: () => new MockPaymentGateway(p), razorpay: () => new RazorpayGateway() }) },
    { provide: MAPS, inject: [PrismaService], useFactory: (p: PrismaService) => choose<MapsAdapter>('maps', env.mapsProvider, { mock: () => new MockMaps(p), google: () => new GoogleMaps() }) },
    { provide: SMS, useFactory: () => choose<SmsAdapter>('sms', env.smsProvider, { mock: () => new MockSms(), twilio: () => new TwilioSms(), sns: () => new SnsSms(), msg91: () => new Msg91Sms() }) },
    { provide: KYC, useFactory: () => choose<KycAdapter>('kyc', env.kycProvider, { mock: () => new MockKyc(), cashfree: () => new CashfreeKyc() }) },
    { provide: MARKET_DATA, useFactory: () => choose<MarketDataAdapter>('market data', env.marketProvider, { mock: () => new MockMarketData(), agmarknet: () => new AgmarknetData() }) },
    { provide: STORAGE, useFactory: () => choose<StorageAdapter>('storage', env.storageProvider, { s3: () => new S3Storage(), mock: () => new MockStorage() }) },
  ],
  exports: [PAYMENT_GATEWAY, MAPS, SMS, KYC, MARKET_DATA, STORAGE],
})
export class AdaptersModule {}
