/** Writes openapi.json without touching a database or Redis (preview mode instantiates no providers). */
import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { buildOpenApi, configureApp } from './bootstrap';

async function main() {
  const app = await NestFactory.create(AppModule, { preview: true, logger: false });
  configureApp(app);
  const out = join(__dirname, '..', 'openapi.json');
  writeFileSync(out, JSON.stringify(buildOpenApi(app), null, 2));
  await app.close();
  console.log(`Wrote ${out}`);
  process.exit(0);
}
main();
