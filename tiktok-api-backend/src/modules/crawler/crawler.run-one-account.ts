/**
 * CrawlerRunOneAccount — scrape + flatten 1 TikTok account, RESUME theo cursor.
 *
 * Steps (rotation):
 *   page = acc.crawlCursorPage   // resume, KHÔNG restart 0
 *   while pagesThisRun < PAGES_PER_RUN:
 *     searchCreators(page) → fullProfile(type 1-3) → write() → lưu cursor=page+1
 *     items rỗng / hasMore=false → reset cursor=0 (quét lại bắt creator mới)
 *     sleep delayBetweenPagesMs
 *
 * Mỗi page = 12 creators (size TikTok cố định). Phân trang TikTok gần như vô
 * hạn (test tới page 1tr vẫn còn data) nên cursor tiến dần qua các lượt =
 * tổng creator lấy được vô hạn. Sheet writer upsert theo keyColumns ['OEC ID']
 * nên creator trùng update row, mới append.
 *
 * Throws TiktokSearchAuthError when cookie is dead → caller handles markCookieDead.
 * Throws generic Error on network/API failures → caller sets lastError, skips acc.
 *
 * Phase 2: signature changed to accept CrawlerGroupDocument (per-group config)
 * instead of AppSettingsDocument. Sheet config and categoryList now come from group.
 */
import { Injectable, Logger } from '@nestjs/common';
import { TiktokClientService } from '../tiktok-client/tiktok-client.service';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { TiktokAccountService } from '../tiktok-account/tiktok-account.service';
import type { TiktokAccountDocument } from '../tiktok-account/schemas/tiktok-account.schema';
import type { CrawlerGroupDocument } from '../crawler-group/schemas/crawler-group.schema';
import { CrawlerWriteSheets } from './crawler.write-sheets';

/**
 * Số page crawl tối đa trong MỘT lượt account = yield budget, KHÔNG phải cap
 * tổng data. Hết budget thì nhường account kế trong rotation; lượt sau resume
 * từ `crawlCursorPage` đã lưu nên tổng creator lấy được là VÔ HẠN theo pool
 * TikTok (đã test: phân trang còn data tới page 1 triệu). Budget này chỉ để
 * 1 account không độc chiếm worker khi pool gần như vô tận.
 */
const PAGES_PER_RUN = 50;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

@Injectable()
export class CrawlerRunOneAccount {
  private readonly logger = new Logger(CrawlerRunOneAccount.name);

  constructor(
    private readonly tiktok: TiktokClientService,
    private readonly writer: CrawlerWriteSheets,
    private readonly settings: AppSettingsService,
    private readonly accounts: TiktokAccountService,
  ) {}

  /**
   * Crawl 1 lượt cho 1 account — RESUME từ `crawlCursorPage` (không restart 0):
   *   For page = cursor, cursor+1, ... (tối đa PAGES_PER_RUN page/lượt):
   *     1. Search marketplace page → up to 12 creators
   *     2. Full profile (type 1-3) cho mỗi creator
   *     3. Upsert sheet Tổng quan → lưu cursor = page+1
   *   has_more=false / page rỗng → reset cursor=0 (quét lại bắt creator mới).
   *
   * Cursor được persist sau mỗi page ghi xong → tổng data lấy được là vô hạn
   * theo pool TikTok (trải qua nhiều lượt rotation), không kẹt ở 1200 như trước.
   *
   * Throws TiktokSearchAuthError nếu cookie chết.
   * Throws Error nếu network/API fail — caller xử lý, lượt sau resume từ cursor.
   */
  async runOneAccount(
    acc: TiktokAccountDocument,
    group: CrawlerGroupDocument,
    shouldStop?: () => boolean,
  ): Promise<void> {
    const s = await this.settings.get();
    const pageDelay = s.delayBetweenPagesMs ?? 0;
    const accId = String(acc._id);

    // Resume từ cursor đã lưu (doc cũ thiếu field → 0).
    let page = acc.crawlCursorPage ?? 0;
    let pagesThisRun = 0;
    let totalCreators = 0;
    let lastWrite: {
      perSheet: Record<string, number>;
      sheetIds: Record<string, number>;
    } | null = null;

    this.logger.log(`[${acc.name}] bắt đầu lượt crawl từ page ${page}`);

    while (pagesThisRun < PAGES_PER_RUN) {
      // Cancellation: caller (GroupWorker) bấm Stop → dừng ở ranh giới page.
      // Cursor chưa advance cho page hiện tại nên lượt sau crawl lại page này.
      if (shouldStop?.()) {
        this.logger.log(
          `[${acc.name}] stop requested — dừng ở page ${page} (lượt này +${totalCreators} creators)`,
        );
        break;
      }

      this.logger.log(`[${acc.name}] searching marketplace page ${page}`);

      const search = await this.tiktok.searchCreators({
        cookie: acc.cookie,
        shopId: acc.shopId,
        shopRegion: acc.shopRegion,
        page,
        categoryList:
          group.categoryList.length > 0 ? group.categoryList : undefined,
      });

      if (search.items.length === 0) {
        // Hết pool → reset cursor 0 để vòng sau quét lại từ đầu (bắt creator mới).
        await this.accounts.setCrawlCursor(accId, 0);
        this.logger.log(
          `[${acc.name}] page=${page} rỗng — hết pool, reset cursor=0 (lượt này +${totalCreators} creators)`,
        );
        break;
      }

      this.logger.log(
        `[${acc.name}] page=${page} → ${search.items.length} creators, fetching fullProfile`,
      );

      // marketplace/find đã trả đầy đủ field overview → flatten thẳng từ items,
      // không cần round-trip /profile riêng cho mỗi creator.
      const profiles = this.tiktok.fullProfile({
        creators: search.items,
        shouldStop,
      });

      // Dừng giữa lúc lấy profile → bỏ write (data dở), KHÔNG advance cursor →
      // lượt sau crawl lại đúng page này.
      if (shouldStop?.()) {
        this.logger.log(
          `[${acc.name}] stop requested sau fullProfile page=${page} — bỏ write, thoát`,
        );
        break;
      }

      this.logger.log(
        `[${acc.name}] page=${page} → upsert ${profiles.length} profiles vào sheet`,
      );

      lastWrite = await this.writer.write(acc, group, profiles);

      totalCreators += search.items.length;
      page++;
      pagesThisRun++;

      if (!search.hasMore) {
        // Pool hết → reset cursor 0 để quét lại từ đầu vòng sau.
        await this.accounts.setCrawlCursor(accId, 0);
        this.logger.log(
          `[${acc.name}] hasMore=false ở page=${page - 1} — hết pool, reset cursor=0 (lượt này +${totalCreators} creators)`,
        );
        break;
      }

      // Persist cursor = page kế (đã ghi xong page-1) → lượt/vòng sau resume.
      await this.accounts.setCrawlCursor(accId, page);

      if (pageDelay > 0) await sleep(pageDelay);
    }

    if (pagesThisRun >= PAGES_PER_RUN) {
      this.logger.log(
        `[${acc.name}] hết budget ${PAGES_PER_RUN} page/lượt — nhường account kế, resume page=${page} vòng sau (lượt này +${totalCreators} creators)`,
      );
    }

    // Format 1 lần cuối lượt (nếu đã ghi ≥1 page và không đang dừng). Lỗi format
    // chỉ ảnh hưởng hiển thị → nuốt, không để fail cả account.
    if (lastWrite && !shouldStop?.()) {
      try {
        await this.writer.formatAll(group, lastWrite);
      } catch (err) {
        this.logger.warn(
          `[${acc.name}] format sheets lỗi (bỏ qua): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }
}
