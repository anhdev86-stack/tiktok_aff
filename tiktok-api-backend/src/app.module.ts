import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { APP_GUARD } from '@nestjs/core';
import { configuration } from './config/configuration';
import { envSchema } from './config/env.validation';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { CryptoModule } from './common/crypto/crypto.module';
import { AuthModule } from './modules/auth/auth.module';
import { TiktokAccountModule } from './modules/tiktok-account/tiktok-account.module';
import { TiktokClientModule } from './modules/tiktok-client/tiktok-client.module';
import { GoogleSheetsModule } from './modules/google-sheets/google-sheets.module';
import { HealthModule } from './modules/health/health.module';
import { ServiceAccountModule } from './modules/service-account/service-account.module';
import { AuditLogModule } from './modules/audit-log/audit-log.module';
import { AppSettingsModule } from './modules/app-settings/app-settings.module';
import { CrawlerModule } from './modules/crawler/crawler.module';
import { CrawlerGroupModule } from './modules/crawler-group/crawler-group.module';
import { MigrationsModule } from './migrations/migrations.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envSchema,
      validationOptions: { abortEarly: false, allowUnknown: true },
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        uri: cfg.get<string>('mongo.uri')!,
        dbName: cfg.get<string>('mongo.db'),
      }),
    }),
    CryptoModule,
    AuditLogModule,
    ServiceAccountModule,
    AuthModule,
    TiktokClientModule,
    GoogleSheetsModule,
    TiktokAccountModule,
    AppSettingsModule,
    CrawlerGroupModule,
    MigrationsModule,
    CrawlerModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}
