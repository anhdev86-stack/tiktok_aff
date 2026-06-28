import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AppSettings, AppSettingsSchema } from './schemas/app-settings.schema';
import { AppSettingsService } from './app-settings.service';
import { AppSettingsController } from './app-settings.controller';

/**
 * AppSettingsModule — global singleton config for the crawler.
 * Exports AppSettingsService so CrawlerModule (phase 2) can inject it.
 * GoogleSheetsModule and ServiceAccountModule are @Global so no explicit import needed.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AppSettings.name, schema: AppSettingsSchema },
    ]),
  ],
  controllers: [AppSettingsController],
  providers: [AppSettingsService],
  exports: [AppSettingsService, MongooseModule],
})
export class AppSettingsModule {}
