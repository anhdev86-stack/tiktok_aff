import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  CrawlerGroup,
  CrawlerGroupSchema,
} from '../modules/crawler-group/schemas/crawler-group.schema';
import {
  TiktokAccount,
  TiktokAccountSchema,
} from '../modules/tiktok-account/schemas/tiktok-account.schema';
import {
  AppSettings,
  AppSettingsSchema,
} from '../modules/app-settings/schemas/app-settings.schema';
import { CreateDefaultCrawlerGroupMigration } from './create-default-crawler-group.migration';

/**
 * MigrationsModule — registers all boot-time idempotent migrations.
 *
 * Import order in AppModule matters: MigrationsModule MUST appear BEFORE
 * CrawlerModule so that NestJS initialises migrations (OnModuleInit) before
 * CrawlerOrchestratorService starts polling groups.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CrawlerGroup.name, schema: CrawlerGroupSchema },
      { name: TiktokAccount.name, schema: TiktokAccountSchema },
      { name: AppSettings.name, schema: AppSettingsSchema },
    ]),
  ],
  providers: [CreateDefaultCrawlerGroupMigration],
})
export class MigrationsModule {}
