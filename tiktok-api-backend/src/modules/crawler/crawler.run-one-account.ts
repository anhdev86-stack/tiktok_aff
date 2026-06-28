/**
 * CrawlerRunOneAccount — scrape + flatten 1 TikTok account, RESUME theo cursor.
 *
 * Steps (rotation):
 *   openCrawlSession()            // mở browser + load SDK 1 LẦN/lượt
 *   page = acc.crawlCursorPage    // resume, KHÔNG restart 0
 *   while pagesThisRun < pagesPerRun:  // burst size từ AppSettings
 *     searchCreatorsInSession(page, searchKey, nextItemCursor)  // tái dùng browser
 *       → dedup OEC (Set) → fullProfile → write() → lưu cursor=nextPage
 *     items rỗng / hasMore=false → reset cursor=0 (quét lại bắt creator mới)
 *     sleep delayBetweenPagesMs
 *   closeCrawlSession()           // luôn đóng (finally)
 *
 * THROUGHPUT: trước đây mỗi page mở 1 browser mới (~25s load SDK) → chỉ ~12
 * creator/25s. Nay mở 1 session/lượt rồi loop ~250 page (mỗi page ~1-2s fetch
 * in-page) → ~3000 creator/lượt. Phân trang dùng con trỏ next_pagination
 * (search_key/next_item_cursor) để TikTok không re-rank gây trùng; thêm Set
 * dedup OEC trong lượt. Sheet writer vẫn upsert theo ['OEC ID'].
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
 * Fallback số page/lượt khi settings chưa cấu hình `pagesPerRun`. Giá trị thật
 * đọc từ AppSettings.pagesPerRun (chỉnh được runtime) — xem runOneAccount.
 *
 * Đây là "burst size" mỗi shop: hết budget thì NHƯỜNG shop kế trong rotation,
 * lượt sau shop này resume từ `crawlCursorPage` đã lưu (pool TikTok ~vô hạn,
 * test tới page 1 triệu vẫn còn data). Để THẤP khi có nhiều shop ⇒ mỗi cookie
 * bắn tràng ngắn rồi nghỉ trong lúc shop khác chạy ⇒ tránh bị hạn chế.
 * Throughput = (số shop) × pagesPerRun × 12 mỗi vòng.
 */
const DEFAULT_PAGES_PER_RUN = 20;

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
   *   For page = cursor, cursor+1, ... (tối đa pagesPerRun page/lượt):
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
    const pagesPerRun =
      s.pagesPerRun && s.pagesPerRun > 0
        ? s.pagesPerRun
        : DEFAULT_PAGES_PER_RUN;
    const accId = String(acc._id);

    // Resume từ cursor đã lưu (doc cũ thiếu field → 0).
    let page = acc.crawlCursorPage ?? 0;
    let pagesThisRun = 0;
    let totalCreators = 0;
    // Dedup trong CÙNG lượt: TikTok có thể trả lại creator đã thấy ở page trước
    // (nhất là khi re-rank) → chỉ flatten/ghi creator MỚI để không tốn quota
    // sheet và không "trùng nhau".
    const seenOecIds = new Set<string>();
    // Con trỏ phân trang ổn định, thread qua từng page trong lượt này.
    let searchKey: string | undefined;
    let nextItemCursor: string | undefined;
    let lastWrite: {
      perSheet: Record<string, number>;
      sheetIds: Record<string, number>;
    } | null = null;

    const categoryList =
      group.categoryList.length > 0 ? group.categoryList : undefined;

    this.logger.log(`[${acc.name}] bắt đầu lượt crawl từ page ${page}`);

    // Mở 1 browser session DUY NHẤT cho cả lượt (load SDK ~22-30s 1 lần), rồi
    // loop nhiều page bằng searchCreatorsInSession (~1-2s/page). Throw nếu cookie
    // chết → caller markCookieDead.
    const session = await this.tiktok.openCrawlSession({
      cookie: acc.cookie,
      shopId: acc.shopId,
      shopRegion: acc.shopRegion,
    });

    try {
      while (pagesThisRun < pagesPerRun) {
        // Cancellation: caller (GroupWorker) bấm Stop → dừng ở ranh giới page.
        // Cursor chưa advance cho page hiện tại nên lượt sau crawl lại page này.
        if (shouldStop?.()) {
          this.logger.log(
            `[${acc.name}] stop requested — dừng ở page ${page} (lượt này +${totalCreators} creators)`,
          );
          break;
        }

        const search = await this.tiktok.searchCreatorsInSession(session, {
          page,
          categoryList,
          searchKey,
          nextItemCursor,
        });

        // Cập nhật con trỏ cho page kế (giữ searchKey cũ nếu response không trả).
        searchKey = search.searchKey ?? searchKey;
        nextItemCursor = search.nextItemCursor;

        if (search.items.length === 0) {
          // Hết pool → reset cursor 0 để vòng sau quét lại từ đầu (bắt creator mới).
          await this.accounts.setCrawlCursor(accId, 0);
          this.logger.log(
            `[${acc.name}] page=${page} rỗng — hết pool, reset cursor=0 (lượt này +${totalCreators} creators)`,
          );
          break;
        }

        // Lọc creator đã thấy trong lượt này → chỉ giữ creator MỚI.
        const fresh = search.items.filter((c) => !seenOecIds.has(c.oec_id));
        for (const c of fresh) seenOecIds.add(c.oec_id);

        // marketplace/find đã trả đầy đủ field overview → flatten thẳng từ items,
        // không cần round-trip /profile riêng cho mỗi creator.
        const profiles = this.tiktok.fullProfile({
          creators: fresh,
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

        if (profiles.length > 0) {
          this.logger.log(
            `[${acc.name}] page=${page} → ${search.items.length} creators (${profiles.length} mới) → upsert vào sheet`,
          );
          lastWrite = await this.writer.write(acc, group, profiles);
          totalCreators += profiles.length;
        } else {
          this.logger.log(
            `[${acc.name}] page=${page} → ${search.items.length} creators đều đã thấy, bỏ qua write`,
          );
        }

        // Advance page: ưu tiên next_page TikTok gợi ý, fallback page+1.
        page = search.nextPage != null ? search.nextPage : page + 1;
        pagesThisRun++;

        if (!search.hasMore) {
          // Pool hết → reset cursor 0 để quét lại từ đầu vòng sau.
          await this.accounts.setCrawlCursor(accId, 0);
          this.logger.log(
            `[${acc.name}] hasMore=false — hết pool, reset cursor=0 (lượt này +${totalCreators} creators)`,
          );
          break;
        }

        // Persist cursor = page kế → lượt/vòng sau resume.
        await this.accounts.setCrawlCursor(accId, page);

        if (pageDelay > 0) await sleep(pageDelay);
      }
    } finally {
      // Luôn đóng session (kể cả lỗi/stop) để không rò browser process.
      await this.tiktok.closeCrawlSession(session);
    }

    if (pagesThisRun >= pagesPerRun) {
      this.logger.log(
        `[${acc.name}] hết budget ${pagesPerRun} page/lượt — nhường account kế, resume page=${page} vòng sau (lượt này +${totalCreators} creators)`,
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
