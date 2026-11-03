/** Phone OTP for everyone, optional email/password for buyers and admins, JWT access + rotating refresh, role guard. */
import { BadRequestException, Body, CanActivate, Controller, createParamDecorator, ExecutionContext, ForbiddenException, Get, HttpCode, HttpException, HttpStatus, Inject, Injectable, Module, Patch, Post, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector, APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role, User } from '@prisma/client';
import { normalisePhone } from '@agrimate/shared';
import { Clock, ConfigService, CryptoService, env, PrismaService } from '../core/core';
import { SMS, SmsAdapter } from '../adapters/others';
import { renderTemplate } from '../notifications/templates';
import { LoginDto, RefreshDto, RequestOtpDto, UpdateMeDto, VerifyOtpDto } from './auth.dto';

export interface AuthUser { id: string; role: Role }
export const Public = () => SetMetadata('isPublic', true);
export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly reflector: Reflector) {}
  async canActivate(ctx: ExecutionContext) {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>('isPublic', targets)) return true;
    const req = ctx.switchToHttp().getRequest();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Missing token');
    let claims: { sub: string; role: Role };
    try { claims = await this.jwt.verifyAsync(token); } catch { throw new UnauthorizedException('Invalid or expired token'); }
    req.user = { id: claims.sub, role: claims.role } satisfies AuthUser;
    const roles = this.reflector.getAllAndOverride<Role[]>('roles', targets);
    if (roles?.length && !roles.includes(claims.role)) throw new ForbiddenException('Your role cannot do this');
    return true;
  }
}

const OTP_MAX_ATTEMPTS = 5;
const REFRESH_TTL_MS = 30 * 86_400_000;

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly crypto: CryptoService, private readonly jwt: JwtService, private readonly clock: Clock, private readonly config: ConfigService, @Inject(SMS) private readonly sms: SmsAdapter) {}

  phoneHash(phone: string) { return this.crypto.blindIndex(normalisePhone(phone)); }

  async requestOtp(phoneRaw: string) {
    const phoneHash = this.phoneHash(phoneRaw);
    const now = this.clock.now();
    const maxPerHour = await this.config.get('otpMaxPerHour');
    const recent = await this.prisma.otpChallenge.count({ where: { phoneHash, createdAt: { gte: new Date(now.getTime() - 3_600_000) } } });
    if (recent >= maxPerHour) throw new HttpException({ code: 'OTP_RATE_LIMITED', message: 'Too many codes requested. Try again later.' }, HttpStatus.TOO_MANY_REQUESTS);
    const code = this.crypto.randomDigits(6);
    const ttl = await this.config.get('otpTtlMinutes');
    await this.prisma.otpChallenge.create({ data: { phoneHash, codeHash: this.crypto.blindIndex(`${phoneHash}:${code}`), expiresAt: new Date(now.getTime() + ttl * 60_000) } });
    // OTPs skip the outbox: they must go out immediately. Existing users get theirs in their own language.
    const user = await this.prisma.user.findUnique({ where: { phoneHash } });
    await this.sms.send(normalisePhone(phoneRaw), renderTemplate('otp', user?.language ?? 'en', { otp: code, minutes: ttl }));
    return { sent: true, expiresInMinutes: ttl, ...(env.exposeDevOtp ? { devOtp: code } : {}) };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const phone = normalisePhone(dto.phone);
    const phoneHash = this.phoneHash(phone);
    const now = this.clock.now();
    const ch = await this.prisma.otpChallenge.findFirst({ where: { phoneHash, consumedAt: null, expiresAt: { gt: now } }, orderBy: { createdAt: 'desc' } });
    if (!ch || ch.attempts >= OTP_MAX_ATTEMPTS) throw new UnauthorizedException({ code: 'OTP_INVALID', message: 'Code is invalid or has expired' });
    if (ch.codeHash !== this.crypto.blindIndex(`${phoneHash}:${dto.code}`)) {
      await this.prisma.otpChallenge.update({ where: { id: ch.id }, data: { attempts: { increment: 1 } } });
      throw new UnauthorizedException({ code: 'OTP_INVALID', message: 'Code is invalid or has expired' });
    }
    let user = await this.prisma.user.findUnique({ where: { phoneHash } });
    // Checked before spending the code, so the signup form can resend it along with the missing details.
    if (!user && (!dto.role || !dto.name)) throw new BadRequestException({ code: 'SIGNUP_DETAILS_REQUIRED', message: 'New number: role and name are required' });
    await this.prisma.otpChallenge.update({ where: { id: ch.id }, data: { consumedAt: now } });
    if (!user) user = await this.createUser({ phone, role: dto.role!, name: dto.name!, language: dto.language });
    if (!user.active) throw new ForbiddenException('Account disabled');
    return this.issueTokens(user);
  }

  /** Also used by the seed script, so that seeded and self-registered accounts are shaped identically. */
  async createUser(i: { phone: string; role: Role; name: string; language?: string; email?: string; password?: string }) {
    const phone = normalisePhone(i.phone);
    return this.prisma.user.create({
      data: {
        role: i.role, name: i.name, language: i.language ?? 'en', phoneEnc: this.crypto.encrypt(phone), phoneHash: this.crypto.blindIndex(phone), phoneLast4: phone.slice(-4),
        email: i.email, passwordHash: i.password ? await this.crypto.hashPassword(i.password) : undefined,
        ...(i.role === 'BUYER' ? { buyer: { create: { companyName: i.name } } } : {}),
        ...(i.role === 'FARMER' ? { farmer: { create: {} } } : {}),
        ...(i.role === 'INSPECTOR' ? { inspector: { create: {} } } : {}),
        ...(i.role === 'LOGISTICS' ? { logistics: { create: {} } } : {}),
      },
    });
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    // Same response for unknown user and bad password, so that login cannot be used to discover accounts.
    if (!user?.passwordHash || !(await this.crypto.verifyPassword(dto.password, user.passwordHash))) throw new UnauthorizedException('Wrong email or password');
    if (user.role !== 'BUYER' && user.role !== 'ADMIN') throw new ForbiddenException('Use phone login');
    if (!user.active) throw new ForbiddenException('Account disabled');
    return this.issueTokens(user);
  }

  async issueTokens(user: User) {
    const accessToken = await this.jwt.signAsync({ sub: user.id, role: user.role }, { expiresIn: '15m' });
    const refreshToken = this.crypto.randomToken();
    await this.prisma.refreshToken.create({ data: { userId: user.id, tokenHash: this.crypto.sha256(refreshToken), expiresAt: new Date(this.clock.now().getTime() + REFRESH_TTL_MS) } });
    return { accessToken, refreshToken, user: this.publicUser(user) };
  }

  /** Rotation: each refresh token works once. Reusing a spent one signals theft and revokes the whole family. */
  async refresh(token: string) {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: this.crypto.sha256(token) }, include: { user: true } });
    if (!row || row.expiresAt < this.clock.now()) throw new UnauthorizedException('Invalid refresh token');
    if (row.revokedAt) {
      await this.prisma.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: this.clock.now() } });
      throw new UnauthorizedException('Invalid refresh token');
    }
    await this.prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: this.clock.now() } });
    if (!row.user.active) throw new ForbiddenException('Account disabled');
    return this.issueTokens(row.user);
  }
  async logout(token: string) {
    await this.prisma.refreshToken.updateMany({ where: { tokenHash: this.crypto.sha256(token), revokedAt: null }, data: { revokedAt: this.clock.now() } });
  }
  publicUser(u: User) { return { id: u.id, role: u.role, name: u.name, language: u.language, phoneLast4: u.phoneLast4, email: u.email }; }
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly prisma: PrismaService, private readonly crypto: CryptoService) {}

  @Public() @Throttle({ default: { limit: 5, ttl: 60_000 } }) @HttpCode(200) @Post('otp/request')
  request(@Body() dto: RequestOtpDto) { return this.auth.requestOtp(dto.phone); }

  @Public() @Throttle({ default: { limit: 10, ttl: 60_000 } }) @HttpCode(200) @Post('otp/verify')
  verify(@Body() dto: VerifyOtpDto) { return this.auth.verifyOtp(dto); }

  @Public() @Throttle({ default: { limit: 10, ttl: 60_000 } }) @HttpCode(200) @Post('login')
  login(@Body() dto: LoginDto) { return this.auth.login(dto); }

  @Public() @HttpCode(200) @Post('refresh')
  refresh(@Body() dto: RefreshDto) { return this.auth.refresh(dto.refreshToken); }

  @Public() @HttpCode(204) @Post('logout')
  logout(@Body() dto: RefreshDto) { return this.auth.logout(dto.refreshToken); }

  @ApiBearerAuth() @Get('me')
  async me(@CurrentUser() u: AuthUser) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: u.id },
      include: { buyer: { select: { companyName: true, kybStatus: true, kybNote: true, gstin: true, defaultPin: true } }, farmer: { select: { type: true, fpoName: true, kycStatus: true, kycNote: true, payoutsEnabled: true, pin: true, district: true, state: true, bankLast4: true, panLast4: true } }, inspector: { select: { status: true, statusNote: true, available: true, serviceRadiusKm: true, degreeType: true, pin: true } }, logistics: { select: { status: true, statusNote: true, partnerType: true, companyName: true, noCoLoadingAcceptedAt: true } } },
    });
    return { ...this.auth.publicUser(user), phone: this.crypto.decrypt(user.phoneEnc), buyer: user.buyer, farmer: user.farmer, inspector: user.inspector, logistics: user.logistics };
  }

  @ApiBearerAuth() @Patch('me')
  async updateMe(@CurrentUser() u: AuthUser, @Body() dto: UpdateMeDto) {
    return this.auth.publicUser(await this.prisma.user.update({ where: { id: u.id }, data: dto }));
  }
}

@Module({
  imports: [JwtModule.registerAsync({ useFactory: () => ({ secret: env.jwtSecret, signOptions: { issuer: 'agrimate' } }) })],
  providers: [AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
