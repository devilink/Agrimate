import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { env } from './core/core';

/** Money is BigInt paise everywhere; on the wire it is a decimal string, because JSON numbers would lose precision. */
(BigInt.prototype as unknown as { toJSON(): string }).toJSON = function (this: bigint) { return this.toString(); };

export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'metrics'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: false } }));
  app.enableCors({ origin: env.corsOrigins, credentials: true });
  return app;
}

export function buildOpenApi(app: INestApplication) {
  return SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Agrimate API').setDescription('All money is integer paise, sent as decimal strings. Times are UTC ISO-8601.').setVersion('1.0').addBearerAuth().build());
}
