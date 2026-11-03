import { ArgumentsHost, Catch, ExceptionFilter, INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { env } from './core/core';

/** Money is BigInt paise everywhere; on the wire it is a decimal string, because JSON numbers would lose precision. */
(BigInt.prototype as unknown as { toJSON(): string }).toJSON = function (this: bigint) { return this.toString(); };

/** Turns the database's own refusals into proper HTTP answers instead of 500s. */
@Catch(Prisma.PrismaClientKnownRequestError)
class PrismaErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('Prisma');
  catch(e: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (e.code === 'P2002') return res.status(409).json({ statusCode: 409, code: 'ALREADY_EXISTS', message: 'That already exists' });
    if (e.code === 'P2025') return res.status(404).json({ statusCode: 404, code: 'NOT_FOUND', message: 'Not found' });
    if (e.code === 'P2003') return res.status(422).json({ statusCode: 422, code: 'INVALID_REFERENCE', message: 'A referenced record does not exist' });
    this.logger.error(`${e.code}: ${e.message}`);
    return res.status(500).json({ statusCode: 500, message: 'Internal server error' });
  }
}

export function configureApp(app: INestApplication) {
  (app.getHttpAdapter().getInstance() as { disable(k: string): void }).disable('x-powered-by');
  app.useGlobalFilters(new PrismaErrorFilter());
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'metrics'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: false } }));
  app.enableCors({ origin: env.corsOrigins, credentials: true });
  return app;
}

export function buildOpenApi(app: INestApplication) {
  return SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Agrimate API').setDescription('All money is integer paise, sent as decimal strings. Times are UTC ISO-8601.').setVersion('1.0').addBearerAuth().build());
}
