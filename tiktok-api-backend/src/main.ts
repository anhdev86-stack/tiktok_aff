import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: true,
      // 256 KiB là quá đủ cho mọi DTO (SA JSON ~2-3KB)
      bodyLimit: 256 * 1024,
      // Disable client-error logs to keep stdout clean (helmet/rate-limit
      // sẽ tự log nếu cần)
    }),
    { bufferLogs: true },
  );

  const cfg = app.get(ConfigService);

  await app.register(helmet as never, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    hidePoweredBy: true,
    hsts: { maxAge: 15552000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: 'no-referrer' },
    xssFilter: true,
    noSniff: true,
    frameguard: { action: 'deny' },
  });

  const globalLimit = cfg.get<number>('rateLimit.global') ?? 100;
  if (globalLimit > 0) {
    await app.register(rateLimit as never, {
      max: globalLimit,
      timeWindow: '1 minute',
      keyGenerator: (req: { ip?: string }) => req.ip ?? 'unknown',
      addHeaders: { 'x-ratelimit-limit': true, 'x-ratelimit-remaining': true },
      errorResponseBuilder: () => ({
        statusCode: 429,
        error: 'Too Many Requests',
        message: 'Bạn đang gửi quá nhiều request. Hãy thử lại sau.',
      }),
    });
  }

  const allowedOrigins = cfg.get<string[]>('corsOrigins') ?? [];
  app.enableCors({
    origin:
      allowedOrigins.length === 0
        ? false
        : allowedOrigins.includes('*')
          ? true
          : allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.setGlobalPrefix(cfg.get<string>('globalPrefix') ?? 'api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  const port = cfg.get<number>('port') ?? 3000;
  const host = cfg.get<string>('host') ?? '0.0.0.0';
  await app.listen(port, host);
  Logger.log(`API listening on http://${host}:${port}`, 'Bootstrap');
}

bootstrap().catch((err) => {
  console.error('[fatal] bootstrap failed', err);
  process.exit(1);
});
