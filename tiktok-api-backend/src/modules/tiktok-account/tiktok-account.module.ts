import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  TiktokAccount,
  TiktokAccountSchema,
} from './schemas/tiktok-account.schema';
import {
  CrawlerGroup,
  CrawlerGroupSchema,
} from '../crawler-group/schemas/crawler-group.schema';
import { TiktokAccountService } from './tiktok-account.service';
import { TiktokAccountController } from './tiktok-account.controller';
import { TiktokClientModule } from '../tiktok-client/tiktok-client.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TiktokAccount.name, schema: TiktokAccountSchema },
      // Inject trực tiếp (không import CrawlerGroupModule) để tránh circular dep.
      // Dùng để auto-assign groupId khi tạo account mới.
      { name: CrawlerGroup.name, schema: CrawlerGroupSchema },
    ]),
    TiktokClientModule,
  ],
  controllers: [TiktokAccountController],
  providers: [TiktokAccountService],
  exports: [TiktokAccountService, MongooseModule],
})
export class TiktokAccountModule {}
