/**
 * CrawlerModule — wires CrawlerOrchestratorService, CrawlerRunOneAccount, CrawlerWriteSheets.
 * CrawlerGroupModule exports CrawlerGroupService (used by orchestrator + workers).
 * TiktokClientModule and GoogleSheetsModule are @Global — no explicit import needed.
 * AuditLogModule is @Global — no explicit import needed.
 */
import { Module } from '@nestjs/common';
import { AppSettingsModule } from '../app-settings/app-settings.module';
import { TiktokAccountModule } from '../tiktok-account/tiktok-account.module';
import { CrawlerGroupModule } from '../crawler-group/crawler-group.module';
import { CrawlerOrchestratorService } from './crawler-orchestrator.service';
import { CrawlerController } from './crawler.controller';
import { CrawlerRunOneAccount } from './crawler.run-one-account';
import { CrawlerWriteSheets } from './crawler.write-sheets';

@Module({
  imports: [
    AppSettingsModule, // provides AppSettingsService (global delays)
    TiktokAccountModule, // provides TiktokAccountService
    CrawlerGroupModule, // provides CrawlerGroupService (exported)
    // TiktokClientModule and GoogleSheetsModule are @Global
    // AuditLogModule is @Global
  ],
  controllers: [CrawlerController],
  providers: [
    CrawlerOrchestratorService,
    CrawlerRunOneAccount,
    CrawlerWriteSheets,
  ],
})
export class CrawlerModule {}
