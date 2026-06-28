import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, Types } from 'mongoose';

export type TiktokAccountDocument = HydratedDocument<TiktokAccount>;

@Schema({ collection: 'tiktok_accounts', timestamps: true })
export class TiktokAccount {
  // Tên gợi nhớ (vd: "Shop A", "shop-vn-1")
  @Prop({ required: true, unique: true, index: true })
  name!: string;

  // Cookie string copy y nguyên từ DevTools (toàn bộ document.cookie)
  // Bao gồm msToken — dùng để puppeteer set cookie + lấy msToken cho query.
  @Prop({ required: true })
  cookie!: string;

  // oec_seller_id của shop. Mỗi shop = 1 account riêng.
  @Prop({ required: true, index: true })
  shopId!: string;

  @Prop({ default: 'VN' })
  shopRegion!: string;

  @Prop({ default: true })
  active!: boolean;

  @Prop()
  note?: string;

  /**
   * Trạng thái cookie cập nhật mỗi lần `checkCookie` chạy. `null` = chưa check
   * lần nào (cookie mới tạo). `false` = đã hết hạn → block search/job đến khi
   * user cập nhật cookie mới.
   */
  @Prop({ type: Boolean, default: null })
  cookieAlive!: boolean | null;

  @Prop({ type: Date, default: null })
  cookieCheckedAt!: Date | null;

  /** Lý do cookie chết (vd: "not_login", "redirect_to_login", HTTP code…) */
  @Prop()
  cookieCheckMessage?: string;

  /**
   * Page tiếp theo cần crawl (resume cursor). Crawler không restart page 0 mỗi
   * vòng nữa mà tiếp tục từ đây để lấy creator MỚI (TikTok phân trang gần như
   * vô hạn — test tới page 1tr vẫn còn data). Reset về 0 khi has_more=false /
   * page rỗng để quét lại bắt creator mới gia nhập. Doc cũ thiếu field → ?? 0.
   */
  @Prop({ type: Number, default: 0 })
  crawlCursorPage!: number;

  /**
   * Nhóm crawler mà account này thuộc về. null = chưa gán nhóm.
   * default: null để các doc cũ load được mà không cần migration ngay.
   * Phase 3 migration sẽ gán tất cả về nhóm Default.
   */
  @Prop({
    type: Types.ObjectId,
    ref: 'CrawlerGroup',
    default: null,
    index: true,
  })
  groupId!: Types.ObjectId | null;
}

export const TiktokAccountSchema = SchemaFactory.createForClass(TiktokAccount);
