/** HTTP surface for the transaction domains. Controllers stay thin: authorise by role, delegate to services. */
import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthUser, CurrentUser, Public, Roles } from '../auth/auth';
import { InspectionService } from '../inspection/inspection.service';
import { DisputesService, LogisticsService } from '../logistics/logistics.service';
import { MarketDataService } from '../market/market.service';
import { InvoiceService } from '../payments/invoice.service';
import { PaymentsService } from '../payments/payments.service';
import { AcceptDto, AcceptListingDto, AcceptTripDto, CaptureSessionDto, ClipDto, ConfirmDeliveryDto, CreateBidDto, CreateDisputeDto, CreateListingDto, CreateRfqDto, DeliverDto, EwayBillDto, ExternalLogisticsDto, FileRefDto, GeoDto, GradingDto, ReasonDto, SpotResultDto, SubmitSelfCertDto } from './orders.dto';
import { OrdersService } from './orders.service';

@ApiTags('marketplace') @ApiBearerAuth() @Controller()
export class MarketplaceController {
  constructor(private readonly orders: OrdersService, private readonly market: MarketDataService) {}

  @Roles('BUYER') @Post('rfqs')
  async createRfq(@CurrentUser() u: AuthUser, @Body() d: CreateRfqDto) {
    const s = await this.market.suggestion(d.commodityId);
    return this.orders.createRfq(u, d, s.averagePaisePerKg);
  }
  @Get('rfqs') listRfqs(@CurrentUser() u: AuthUser) { return this.orders.listRfqs(u); }
  @Roles('BUYER') @HttpCode(200) @Post('rfqs/:id/cancel') cancelRfq(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.orders.cancelRfq(u, id); }
  @Roles('FARMER') @Post('rfqs/:id/bids') bid(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: CreateBidDto) { return this.orders.submitBid(u, id, d); }
  @Roles('BUYER', 'ADMIN') @Get('rfqs/:id/bids') bids(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.orders.listBids(u, id); }
  @Roles('BUYER') @HttpCode(200) @Post('bids/:id/accept') accept(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: AcceptDto) { return this.orders.acceptBid(u, id, d.acceptContract); }

  @Roles('FARMER') @Post('listings') createListing(@CurrentUser() u: AuthUser, @Body() d: CreateListingDto) { return this.orders.createListing(u, d); }
  @Get('listings') listings(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) { return this.orders.browseListings(u, q); }
  @Roles('BUYER') @HttpCode(200) @Post('listings/:id/accept') acceptListing(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: AcceptListingDto) { return this.orders.acceptListing(u, id, d); }
  @Roles('FARMER') @HttpCode(200) @Post('listings/:id/withdraw') withdraw(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.orders.withdrawListing(u, id); }

  @Get('market/suggestion') suggestion(@Query('commodityId') c: string) { return this.market.suggestion(c); }
  @Get('market/prices') prices(@Query('commodityId') c: string, @Query('market') m?: string, @Query('months') months?: string) { return this.market.series(c, m, months ? Number(months) : 6); }
  @Get('market/markets') markets(@Query('commodityId') c: string) { return this.market.markets(c); }
}

@ApiTags('orders') @ApiBearerAuth() @Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService, private readonly logistics: LogisticsService, private readonly disputes: DisputesService, private readonly inspection: InspectionService, private readonly invoices: InvoiceService) {}

  @Get() list(@CurrentUser() u: AuthUser, @Query('state') s?: string) { return this.orders.listMine(u, s); }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.orders.view(u, id); }
  @Get(':id/events')
  async events(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    this.orders.assertAccess(u, await this.orders.getFull(id));
    return this.orders.events(id);
  }
  @Roles('BUYER', 'ADMIN') @HttpCode(200) @Post(':id/cancel') cancel(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: ReasonDto) { return this.orders.cancelOrder(u, id, d.reason); }
  @Roles('BUYER', 'ADMIN') @Get(':id/freight-quote') quote(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.logistics.quote(u, id); }
  @Roles('BUYER') @HttpCode(200) @Post(':id/logistics/platform') book(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.logistics.bookPlatform(u, id); }
  @Roles('BUYER') @HttpCode(200) @Post(':id/logistics/external') external(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: ExternalLogisticsDto) { return this.logistics.declareExternal(u, id, d); }
  @Roles('BUYER', 'FARMER', 'ADMIN') @HttpCode(200) @Post(':id/depart') depart(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.logistics.depart(u, id); }
  @Roles('BUYER', 'ADMIN') @HttpCode(200) @Post(':id/confirm-delivery') confirm(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: ConfirmDeliveryDto) { return this.logistics.confirmDelivery(u, id, d); }
  @Roles('BUYER') @HttpCode(200) @Post(':id/deviation/accept') deviation(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.inspection.acceptDeviation(u, id); }
  @Roles('FARMER') @Post(':id/dispatch-photos') photo(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: FileRefDto) { return this.orders.addDispatchPhoto(u, id, d.fileId); }

  @Roles('BUYER', 'ADMIN') @Get(':id/dispute-eligibility') eligibility(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.disputes.eligibility(u, id); }
  @Roles('BUYER') @Post(':id/disputes') dispute(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: CreateDisputeDto) { return this.disputes.raise(u, id, d); }
  @Roles('BUYER') @Post(':id/spot-tests') spot(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.disputes.requestSpotTest(u, id); }
  @Get(':id/invoices') inv(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.invoices.listFor(u, id); }
}

@ApiTags('quality') @ApiBearerAuth() @Controller()
export class QualityController {
  constructor(private readonly disputes: DisputesService, private readonly invoices: InvoiceService, private readonly orders: OrdersService) {}
  @Roles('BUYER', 'ADMIN') @HttpCode(200) @Post('spot-tests/:id/result') result(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: SpotResultDto) { return this.disputes.spotResult(u, id, d); }
  @Get('invoices/:id/pdf')
  async pdf(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const { number, buffer } = await this.invoices.renderPdf(u, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${number}.pdf"`);
    res.end(buffer);
  }
  @Roles('FARMER') @Get('ledger/me') ledger(@CurrentUser() u: AuthUser) { return this.orders.farmerLedger(u); }
  @Roles('INSPECTOR', 'LOGISTICS', 'FARMER') @Get('payouts/me') payouts(@CurrentUser() u: AuthUser) { return this.orders.payeeEarnings(u); }
}

@ApiTags('inspection') @ApiBearerAuth() @Controller()
export class InspectionController {
  constructor(private readonly s: InspectionService) {}
  @Roles('INSPECTOR') @Get('inspector/jobs') jobs(@CurrentUser() u: AuthUser) { return this.s.jobs_(u); }
  @Roles('INSPECTOR') @HttpCode(200) @Post('inspections/:id/check-in') checkIn(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: GeoDto) { return this.s.checkIn(u, id, d); }
  @Roles('INSPECTOR') @HttpCode(200) @Post('inspections/:id/grading') grading(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: GradingDto) { return this.s.saveGrading(u, id, d); }
  @Roles('INSPECTOR') @HttpCode(200) @Post('inspections/:id/mark-inspected') mark(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.s.markInspected(u, id); }
  @Roles('INSPECTOR') @HttpCode(200) @Post('inspections/:id/cancel') cancel(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.s.cancelJob(u, id); }

  @Roles('FARMER') @Post('self-cert/:orderId/session') session(@CurrentUser() u: AuthUser, @Param('orderId') id: string, @Body() d: CaptureSessionDto) { return this.s.openCaptureSession(u, id, d); }
  @Roles('FARMER') @Post('self-cert/:orderId/clips') clip(@CurrentUser() u: AuthUser, @Param('orderId') id: string, @Body() d: ClipDto) { return this.s.addClip(u, id, d); }
  @Roles('FARMER') @HttpCode(200) @Post('self-cert/:orderId/submit') submit(@CurrentUser() u: AuthUser, @Param('orderId') id: string, @Body() d: SubmitSelfCertDto) { return this.s.submitSelfCert(u, id, d); }
}

@ApiTags('trips') @ApiBearerAuth() @Roles('LOGISTICS') @Controller('trips')
export class TripsController {
  constructor(private readonly s: LogisticsService) {}
  @Get('available') available(@CurrentUser() u: AuthUser) { return this.s.available(u); }
  @Get('mine') mine(@CurrentUser() u: AuthUser) { return this.s.mine(u); }
  @HttpCode(200) @Post(':id/accept') accept(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: AcceptTripDto) { return this.s.accept(u, id, d); }
  @HttpCode(200) @Post(':id/eway-bill') eway(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: EwayBillDto) { return this.s.uploadEway(u, id, d); }
  @HttpCode(200) @Post(':id/pickup') pickup(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.s.pickup(u, id); }
  @HttpCode(200) @Post(':id/deliver') deliver(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: DeliverDto) { return this.s.deliver(u, id, d); }
}

@ApiTags('webhooks') @SkipThrottle() @Controller('webhooks')
export class WebhooksController {
  constructor(private readonly payments: PaymentsService) {}
  /** Authenticated by HMAC over the raw bytes, not by JWT. */
  @Public() @ApiExcludeEndpoint() @HttpCode(200) @Post('razorpay')
  razorpay(@Req() req: Request & { rawBody?: Buffer }, @Headers('x-razorpay-signature') sig?: string, @Headers('x-razorpay-event-id') eventId?: string) {
    return this.payments.handleWebhook(req.rawBody, sig, eventId);
  }
}
