import { Module, OnApplicationBootstrap, Inject } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdaptersModule } from './adapters/adapters.module';
import { STORAGE, StorageAdapter } from './adapters/others';
import { AdminController, AdminService, DevController, HealthController } from './admin/admin';
import { AnalyticsController, AnalyticsService } from './analytics/analytics';
import { AuthModule } from './auth/auth';
import { CoreModule } from './core/core';
import { EngineModule, JobsService, NotificationsService } from './engine/engine';
import { InspectionService } from './inspection/inspection.service';
import { DisputesService, LogisticsService } from './logistics/logistics.service';
import { MarketDataService } from './market/market.service';
import { OnboardingModule } from './onboarding/onboarding';
import { InspectionController, MarketplaceController, OrdersController, QualityController, TripsController, WebhooksController } from './orders/controllers';
import { OrdersService } from './orders/orders.service';
import { InvoiceService } from './payments/invoice.service';
import { PaymentsService } from './payments/payments.service';
import { SettlementService } from './payments/settlement.service';

@Module({
  imports: [
    CoreModule, AdaptersModule, EngineModule, AuthModule, OnboardingModule,
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 300 }], skipIf: () => process.env.NODE_ENV === 'test' }),
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    OrdersService, PaymentsService, SettlementService, InvoiceService, InspectionService, LogisticsService, DisputesService, MarketDataService, AdminService, AnalyticsService,
  ],
  controllers: [MarketplaceController, OrdersController, QualityController, InspectionController, TripsController, WebhooksController, AdminController, AnalyticsController, HealthController, DevController],
})
export class AppModule implements OnApplicationBootstrap {
  constructor(private readonly jobs: JobsService, private readonly notifications: NotificationsService, @Inject(STORAGE) private readonly storage: StorageAdapter) {}
  async onApplicationBootstrap() {
    this.jobs.repeat('outbox-flush', () => this.notifications.flush(), { every: 15_000 });
    await this.storage.init();
    this.jobs.startSchedules();
  }
}
