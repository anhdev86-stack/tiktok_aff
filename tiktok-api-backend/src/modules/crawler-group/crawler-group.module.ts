import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  CrawlerGroup,
  CrawlerGroupSchema,
} from './schemas/crawler-group.schema';
import { CrawlerGroupService } from './crawler-group.service';
import { CrawlerGroupController } from './crawler-group.controller';
import { TiktokAccountModule } from '../tiktok-account/tiktok-account.module';

/**
 * CrawlerGroupModule — CRUD for crawler_groups collection.
 * Exports CrawlerGroupService so CrawlerModule (Phase 2 Orchestrator) can inject it.
 * Imports TiktokAccountModule (exports MongooseModule) to access TiktokAccount model
 * for account-count validation on delete.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CrawlerGroup.name, schema: CrawlerGroupSchema },
    ]),
    TiktokAccountModule, // re-exports MongooseModule with TiktokAccount schema
  ],
  controllers: [CrawlerGroupController],
  providers: [CrawlerGroupService],
  exports: [CrawlerGroupService, MongooseModule],
})
export class CrawlerGroupModule {}
