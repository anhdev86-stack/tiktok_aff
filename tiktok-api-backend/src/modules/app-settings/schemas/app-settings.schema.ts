import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, Types } from 'mongoose';

export type AppSettingsDocument = HydratedDocument<AppSettings>;

/**
 * Singleton collection `app_settings` — chỉ 1 doc, key='singleton'.
 * Chỉ còn giữ global delay config. Các field sheet config + live status
 * đã chuyển sang CrawlerGroup (per-group). Xem phase-01 spec.
 *
 * @deprecated fields bên dưới: vẫn còn trong schema để không break code hiện tại.
 * Phase 3 migration sẽ copy dữ liệu sang CrawlerGroup rồi $unset chúng.
 */
@Schema({ collection: 'app_settings', timestamps: true })
export class AppSettings {
  /** Khóa singleton — unique constraint đảm bảo chỉ có 1 doc. */
  @Prop({ default: 'singleton', unique: true, index: true })
  key!: string;

  /** Delay giữa các account trong 1 vòng (ms). Default 0. */
  @Prop({ default: 0, min: 0 })
  delayBetweenAccountsMs!: number;

  /**
   * Delay giữa các vòng lặp (ms). Default 60_000 (1 phút).
   * Buffer tối thiểu để tránh Google Sheets quota (~300 req/min) khi > 10 account.
   * Set 0 để chạy max speed (chỉ dùng khi account ít hoặc đã có throttle khác).
   */
  @Prop({ default: 60_000, min: 0 })
  delayBetweenLoopsMs!: number;

  /**
   * Delay giữa các page khi 1 account quét nhiều trang creators (ms). Default 0.
   * Áp dụng cho rotation crawler: với mỗi account, runOneAccount sẽ lặp
   * searchCreators(page=0..N) cho đến khi hasMore=false. Đặt > 0 để giảm tải
   * và tránh rate-limit khi TikTok trả nhiều page liên tiếp.
   */
  @Prop({ default: 0, min: 0 })
  delayBetweenPagesMs!: number;

  /**
   * Số page MỘT shop crawl mỗi lượt trước khi nhường shop kế (1 page = 12
   * creator). Default 20 (~240 creator/lượt/shop). Đây là "kích thước burst":
   * để THẤP khi có NHIỀU shop → mỗi cookie chỉ bắn 1 tràng ngắn rồi nghỉ trong
   * lúc các shop khác chạy ⇒ tránh bị TikTok hạn chế. Để CAO khi ít shop và
   * muốn 1 shop khai thác sâu. Tổng throughput = (số shop) × pagesPerRun × 12
   * mỗi vòng. Lượt sau mỗi shop resume từ crawlCursorPage đã lưu.
   */
  @Prop({ default: 20, min: 1 })
  pagesPerRun!: number;

  // ─── DEPRECATED — moved to CrawlerGroup (per-group) ─────────────────────
  // DO NOT use these fields in new code. Phase 3 migration will $unset them.

  /** @deprecated — moved to CrawlerGroup.spreadsheetId */
  @Prop({ default: '' })
  spreadsheetId!: string;

  /** @deprecated — moved to CrawlerGroup.sheetOverview */
  @Prop({ default: 'Tổng quan' })
  sheetOverview!: string;

  /** @deprecated — moved to CrawlerGroup.sheetTopVideos */
  @Prop({ default: 'Video nổi bật' })
  sheetTopVideos!: string;

  /** @deprecated — moved to CrawlerGroup.sheetTrend */
  @Prop({ default: 'Xu hướng' })
  sheetTrend!: string;

  /** @deprecated — moved to CrawlerGroup.categoryList */
  @Prop({ type: [[String]], default: [] })
  categoryList!: Array<[string, string]>;

  /** @deprecated — moved to CrawlerGroup.enabled */
  @Prop({ default: false })
  crawlerEnabled!: boolean;

  /** @deprecated — moved to CrawlerGroup.status */
  @Prop({ default: 'idle' })
  crawlerStatus!: 'idle' | 'running' | 'sleeping' | 'stopping';

  /** @deprecated — moved to CrawlerGroup.currentAccountId */
  @Prop({ type: Types.ObjectId, default: null, ref: 'TiktokAccount' })
  currentAccountId!: Types.ObjectId | null;

  /** @deprecated — moved to CrawlerGroup.lastLoopStartedAt */
  @Prop({ type: Date, default: null })
  lastLoopStartedAt!: Date | null;

  /** @deprecated — moved to CrawlerGroup.lastLoopFinishedAt */
  @Prop({ type: Date, default: null })
  lastLoopFinishedAt!: Date | null;

  /** @deprecated — moved to CrawlerGroup.loopCount */
  @Prop({ default: 0 })
  loopCount!: number;

  /** @deprecated — moved to CrawlerGroup.lastError */
  @Prop({ default: '' })
  lastError!: string;
}

export const AppSettingsSchema = SchemaFactory.createForClass(AppSettings);
