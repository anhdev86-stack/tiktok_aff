/**
 * TiktokClientModule — @Global vì TiktokClientService được dùng rải rác
 * (tiktok-account, crawler) và chỉ nên có MỘT session pool cho cả app; import
 * lại ở nhiều module sẽ tạo nhiều pool Chrome.
 *
 * KHÔI PHỤC: dịch ngược từ `dist/` image production
 * `hecatechvn/tiktok-api-backend:latest` (build 2026-06-28).
 */
import { Global, Module } from '@nestjs/common';
import { TiktokClientService } from './tiktok-client.service';
import { TiktokSessionManager } from './tiktok-session.manager';

@Global()
@Module({
  providers: [TiktokClientService, TiktokSessionManager],
  exports: [TiktokClientService, TiktokSessionManager],
})
export class TiktokClientModule {}
