import 'reflect-metadata';
import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { buildOpenApi, configureApp } from './bootstrap';
import { env } from './core/core';

async function main() {
  // rawBody: webhook signatures are computed over the exact bytes received.
  const app = await NestFactory.create(AppModule, { rawBody: true, logger: new ConsoleLogger({ json: env.isProd }) });
  configureApp(app);
  SwaggerModule.setup('docs', app, buildOpenApi(app));
  app.enableShutdownHooks();
  await app.listen(env.port, '0.0.0.0');
  new Logger('Bootstrap').log(`API on :${env.port}  docs at /docs`);
}
main();
