/**
 * TiktokClientService — API nghiệp vụ trên nền TiktokSessionManager.
 *
 * KHÔI PHỤC + DỰNG LẠI:
 *   - searchCreators / getMarketplaceOptions / checkCookie / fullProfile và 2
 *     class lỗi: dịch ngược từ `dist/` image production
 *     `hecatechvn/tiktok-api-backend:latest` (build 2026-06-28 = commit 3f6ed54).
 *   - openCrawlSession / searchCreatorsInSession / closeCrawlSession và
 *     fullProfile theo session: VIẾT LẠI, vì image production được build TRƯỚC
 *     commit e44dbf6 (2026-06-29 "Nâng throughput crawler") nên không chứa lớp
 *     này. Xem ghi chú ⚠️ ở searchCreatorsInSession về phần cần kiểm chứng thật.
 */
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TiktokSessionManager } from './tiktok-session.manager';
import type { SignedFetchResult } from './tiktok-browser';
import {
  hasLoginSession,
  mergeCookieString,
  parseCookieString,
} from './cookie.util';
import {
  flattenOverview,
  flattenOverviewFromCard,
  flattenTopVideos,
  flattenTrend,
  type OverviewResult,
} from './flatten.util';

const PROFILE_PATH = '/api/v1/oec/affiliate/creator/marketplace/profile';
const FIND_PATH = '/api/v1/oec/affiliate/creator/marketplace/find';
const OPTION_PATH = '/api/v1/oec/affiliate/creator/marketplace/option';

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/**
 * Lỗi thuộc về session/cookie (không phải lỗi nghiệp vụ) → caller nên
 * markCookieDead thay vì retry.
 */
const SESSION_DEAD_PATTERN =
  /byted_acrawler missing|frontierSign (?:is not a function|threw|not ready)|Bootstrap context .*fail|cookie missing msToken|cookie chưa đăng nhập|fetch returned undefined/i;

export function isSessionDeadError(err?: string): boolean {
  return !!err && SESSION_DEAD_PATTERN.test(err);
}

/** TikTok trả code != 0 — `code` là option_code dùng để phân loại phía trên. */
export class TiktokSearchAuthError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'TiktokSearchAuthError';
  }
}

/** Session/cookie không auth được — caller markCookieDead. */
export class TiktokSessionDeadError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'TiktokSessionDeadError';
  }
}

/**
 * TikTok trả `code:100000` trên endpoint `/marketplace/*` — chữ ký/wire
 * fingerprint bị từ chối (page chưa patch xong `window.fetch` để chèn X-Gnarly),
 * KHÔNG phải cookie chết. Xem docs/tiktok-signing-notes.md (probe 2026-04-26):
 * cookie hoàn toàn hợp lệ vẫn ra 100000 khi sign chưa đủ.
 *
 * PHÂN BIỆT với TiktokSearchAuthError: đây là lỗi PIPELINE (re-bootstrap +
 * retry rồi thử lại lượt sau), TUYỆT ĐỐI không markCookieDead — nếu không, một
 * sự cố ký request (TikTok đổi bundle / page init chậm) sẽ giết sạch mọi cookie
 * tốt cùng lúc. Cookie chết thật bị bắt sớm hơn ở bootstrap (redirect →
 * TiktokSessionDeadError "cookie chưa đăng nhập").
 */
export class TiktokSignRejectedError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'TiktokSignRejectedError';
  }
}

/**
 * Các code TikTok trả khi CHỮ KÝ bị từ chối (không phải cookie chết). `100000`
 * là code đã probe cho `/marketplace/*`. Để tách riêng thành hằng số để sau này
 * gặp code sign-layer khác thì bổ sung 1 chỗ.
 */
const SIGN_REJECTED_CODES = new Set<number>([100000]);

export function isSignRejectedCode(code?: number): boolean {
  return typeof code === 'number' && SIGN_REJECTED_CODES.has(code);
}

export interface SearchCreatorItem {
  oec_id: string;
  handle: string | null;
  nickname: string | null;
  avatar: string | null;
  selectionRegion: string | null;
  follower_cnt: number | null;
  categories: string[];
  gmvRange: unknown;
  gmvMedian: {
    value: number | null;
    format: string | null;
    symbol: string | null;
  };
  unitsSold: number | null;
  unitsSoldRange: unknown;
  avgViewCnt: number | null;
  engagementRaw: number | null;
  engagementPercent: number | null;
  topGender: { key: string; value: unknown } | null;
  topAgeRanges: string[];
  topVideo: unknown;
  isOpenAccount: unknown;
  isOfficialRecommend: unknown;
}

export interface SearchCreatorsResult {
  page: number;
  size: number;
  total?: number;
  hasMore: boolean;
  items: SearchCreatorItem[];
}

/** Kết quả 1 page trong crawl session — kèm con trỏ phân trang cho page kế. */
export interface SearchInSessionResult extends SearchCreatorsResult {
  searchKey?: string;
  nextItemCursor?: string;
  nextPage?: number;
}

export interface MarketplaceOption {
  id: string;
  name: string;
}

export interface MarketplaceCategory extends MarketplaceOption {
  option_children: MarketplaceOption[];
}

export interface MarketplaceOptionsResult {
  category: MarketplaceCategory[];
  brand: MarketplaceOption[];
  priceRange: MarketplaceOption[];
  language: MarketplaceOption[];
}

export interface CreatorFullProfile {
  creator: {
    oec_id: string;
    handle: string | null;
    nickname: string | null;
  };
  overview: OverviewResult;
  top_videos: Array<Record<string, unknown>>;
  trend: Array<Record<string, unknown>>;
  raw_profile_by_type?: Record<number, unknown>;
}

/**
 * Handle của 1 lượt crawl. Cố ý nhẹ: context Chrome thật do
 * TiktokSessionManager sở hữu và cache theo cookie — handle chỉ mang đủ thông
 * tin để định danh slot đó.
 */
export interface CrawlSession {
  cookie: string;
  shopId: string;
  shopRegion: string;
  openedAt: number;
}

/**
 * profile_type dùng khi enrich: flattenOverview chỉ gộp creator_profile của
 * 1/2/3. Type 4 (trend) và 5 (top video) từng phục vụ 2 sheet đã bỏ → không gọi
 * nữa, tiết kiệm 40% số request /profile.
 */
const OVERVIEW_PROFILE_TYPES = [1, 2, 3];

/** Danh sách ngành hàng đổi rất chậm — cache 12 tiếng là quá đủ. */
const CATEGORY_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

@Injectable()
export class TiktokClientService {
  private readonly logger = new Logger(TiktokClientService.name);

  constructor(
    private readonly cfg: ConfigService,
    private readonly sessionManager: TiktokSessionManager,
  ) {}

  /**
   * Danh sách cặp [ngànhCha, ngànhCon] để xoay vòng, cache theo shopRegion.
   *
   * Cache vì `getMarketplaceOptions` tốn 1 request TikTok, mà danh sách ngành
   * gần như không đổi. Key theo region: ngành hàng khác nhau giữa VN/TH/PH/MY.
   */
  private readonly categoryCache = new Map<
    string,
    { pairs: Array<[string, string]>; at: number }
  >();

  /**
   * Lấy toàn bộ cặp [cha, con] cho region của account này.
   *
   * Trả `[]` nếu không lấy được — caller phải hiểu là "crawl không lọc" chứ
   * không được để hỏng lượt: mất bộ lọc chỉ làm crawl kém hiệu quả, còn throw
   * ở đây thì mất luôn cả lượt.
   */
  async listCategoryPairs(opts: {
    cookie: string;
    shopId: string;
    shopRegion: string;
  }): Promise<Array<[string, string]>> {
    const hit = this.categoryCache.get(opts.shopRegion);
    if (hit && Date.now() - hit.at < CATEGORY_CACHE_TTL_MS) return hit.pairs;

    try {
      const o = await this.getMarketplaceOptions(opts);
      const pairs: Array<[string, string]> = [];
      for (const parent of o.category) {
        for (const child of parent.option_children) {
          pairs.push([parent.id, child.id]);
        }
      }
      this.categoryCache.set(opts.shopRegion, { pairs, at: Date.now() });
      this.logger.log(
        `Category rotation region=${opts.shopRegion}: ${o.category.length} ngành chính → ${pairs.length} ngành con`,
      );
      return pairs;
    } catch (e) {
      this.logger.warn(
        `Không lấy được danh sách ngành (region=${opts.shopRegion}), crawl không lọc: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return [];
    }
  }

  // ─── Crawl session API (dùng bởi CrawlerRunOneAccount) ───────────────────

  /**
   * Mở 1 lượt crawl: bootstrap context ngay để lỗi cookie chết lộ tại đây.
   * Context được TÁI DÙNG giữa các lượt (manager cache 30 phút theo cookie), nên
   * lượt thứ 2 trở đi gần như không tốn chi phí bootstrap.
   */
  async openCrawlSession(opts: {
    cookie: string;
    shopId: string;
    shopRegion: string;
  }): Promise<CrawlSession> {
    try {
      await this.sessionManager.warmup(opts);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isSessionDeadError(msg)) throw new TiktokSessionDeadError(msg);
      throw e;
    }
    return { ...opts, openedAt: Date.now() };
  }

  /**
   * Lấy chuỗi cookie ĐÃ GIA HẠN từ context đang sống, gộp lên cookie gốc.
   *
   * Mỗi request TikTok trả Set-Cookie làm mới sessionid / gia hạn sid_guard /
   * xoay msToken. Browser giữ chúng trong context, nhưng context đóng là mất —
   * trước đây DB luôn giữ bản cookie cũ nên nó chỉ già đi tới lúc hết hạn cứng,
   * bắt user dán lại liên tục. Đọc ngược ra rồi lưu lại thì session tự gia hạn
   * y như trình duyệt thật.
   *
   * Trả `null` khi không có gì đáng lưu (không còn context, hoặc không cookie
   * nào đổi) để caller khỏi ghi DB thừa.
   */
  async readRefreshedCookie(
    session: CrawlSession,
  ): Promise<{ cookie: string; changed: string[] } | null> {
    const fresh = await this.sessionManager.readLiveCookies(session);
    if (fresh.length === 0) return null;

    const { merged, changed } = mergeCookieString(session.cookie, fresh);
    if (changed.length === 0) return null;

    // Chốt chặn cuối: tuyệt đối không lưu đè bằng chuỗi đã mất token đăng nhập.
    // Nếu TikTok vừa đăng xuất phiên này, cookie trong context là bản "đã logout"
    // — ghi đè lên cookie tốt là tự tay phá account.
    if (!hasLoginSession(parseCookieString(merged))) {
      this.logger.warn(
        `Bỏ qua write-back cookie shop=${session.shopId}: bản mới không còn token đăng nhập`,
      );
      return null;
    }

    return { cookie: merged, changed };
  }

  /**
   * Đóng lượt crawl — CHỦ Ý không tear down context.
   *
   * Manager sở hữu vòng đời context: idle sweep 30 phút, giới hạn pool, và
   * onApplicationShutdown đóng sạch. Nếu đóng cưỡng bức ở đây thì mỗi lượt
   * rotation lại tốn ~25s bootstrap — đúng thứ commit e44dbf6 muốn loại bỏ.
   */
  async closeCrawlSession(session: CrawlSession): Promise<void> {
    this.logger.debug?.(
      `Crawl session shop=${session.shopId} kết thúc sau ${Date.now() - session.openedAt}ms ` +
        `(context giữ lại cho lượt sau)`,
    );
  }

  /**
   * Tìm creator trong 1 crawl session, phân trang bằng CON TRỎ.
   *
   * PHÂN TRANG BẰNG CON TRỎ — gửi `search_key` + `next_item_cursor` CÙNG NHAU.
   *
   * Đo thực tế (2026-08-05) chứng minh TikTok **bỏ qua tham số `page`**:
   * `next_item_cursor` trả về luôn bằng 12 ở MỌI page (11, 12, …, 21, rồi 0, 1,
   * 2) chứ không tăng 24/36. Tức mỗi request đều được xử lý như "12 item đầu của
   * một tìm kiếm mới"; `next_page` chỉ echo lại số ta gửi lên.
   *
   * Hậu quả khi phân trang theo `page`: crawler múc đi múc lại cùng một pool
   * top. Re-rank ngẫu nhiên khiến mỗi lần bốc ra 12 creator hơi khác (trong 1
   * lượt vẫn báo "12 mới"), nhưng vét cạn pool là sheet đứng im — đúng hiện
   * tượng dừng tăng từ 22:40 ngày 04/08 ở mốc 2877 creator.
   *
   * QUY TẮC: gửi CẢ CẶP hoặc KHÔNG GỬI GÌ. Gửi mỗi `search_key` mà thiếu cursor
   * thì TikTok trả 0 item + has_more=false (đã đo 04/08) — vì cursor mặc định 0
   * trong khi search_key đó đã tiêu thụ tới 0 rồi.
   *
   * Request đầu mỗi lượt không có cặp con trỏ → TikTok trả về search_key +
   * cursor, từ page sau mới thread được. Xác minh đúng: quan sát
   * `next_item_cursor` phải TĂNG DẦN 12 → 24 → 36.
   */
  async searchCreatorsInSession(
    session: CrawlSession,
    p: {
      page: number;
      categoryList?: Array<[string, string]>;
      /** Đọc ra để quan sát/log — hiện KHÔNG gửi lên TikTok (xem docblock). */
      searchKey?: string;
      nextItemCursor?: string;
    },
  ): Promise<SearchInSessionResult> {
    const size = 12;
    const refererUrl = this.creatorRefererUrl(session);

    const filterParams: Record<string, unknown> = {};
    if (p.categoryList?.length) {
      filterParams.category_list = p.categoryList.map(([parent, child]) => ({
        string_list: [parent, child],
      }));
    }

    const pagination: Record<string, unknown> = { page: p.page, size };
    // CẶP hoặc KHÔNG — không bao giờ gửi lẻ một vế (xem docblock).
    if (p.searchKey && p.nextItemCursor != null) {
      const cursorNum = Number(p.nextItemCursor);
      if (Number.isFinite(cursorNum)) {
        pagination.search_key = p.searchKey;
        pagination.next_item_cursor = cursorNum;
      }
    }

    const body = JSON.stringify({
      query: '',
      pagination,
      algorithm: 1,
      filter_params: filterParams,
    });

    const res = await this.sessionManager.signAndFetch({
      cookie: session.cookie,
      shopId: session.shopId,
      shopRegion: session.shopRegion,
      apiPath: FIND_PATH,
      body,
      refererUrl,
    });

    if (res.error) {
      if (isSessionDeadError(res.error)) {
        throw new TiktokSessionDeadError(res.error);
      }
      throw new InternalServerErrorException(
        `searchCreatorsInSession sign/fetch failed: ${res.error}`,
      );
    }

    const parsed = this.parseJson(res.body);
    const base = mapSearchResponse(parsed, p.page, size);
    const cursor = readNextPagination(parsed);

    // Log con trỏ TikTok trả về ở MỌI page (kể cả page có data) để sau này muốn
    // chuyển sang phân trang bằng cursor thì có sẵn dữ liệu thật đối chiếu —
    // trước đây chỉ log khi 0 item nên không biết page thành công trả gì.
    this.logger.log(
      `find page=${p.page} sentCursor=${pagination.next_item_cursor ?? '-'} → ` +
        `${base.items.length} items | hasMore=${base.hasMore} ` +
        `next_item_cursor=${cursor.nextItemCursor ?? '-'} ` +
        `search_key=${cursor.searchKey ? cursor.searchKey.slice(0, 10) + '…' : '-'}`,
    );

    if (base.items.length === 0) {
      this.logger.warn(
        `searchCreatorsInSession 0 items (page=${p.page}). Raw body[0..400]=${(res.body ?? '').slice(0, 400)}`,
      );
    }

    return { ...base, ...cursor };
  }

  // ─── API gốc (khôi phục nguyên trạng) ────────────────────────────────────

  /** Tìm creator không dùng session handle — giữ cho tương thích ngược. */
  async searchCreators(p: {
    cookie: string;
    shopId: string;
    shopRegion: string;
    page?: number;
    query?: string;
    categoryList?: Array<[string, string]>;
  }): Promise<SearchCreatorsResult> {
    const page = p.page ?? 0;
    const size = 12;
    const query = (p.query ?? '').trim();
    const refererUrl = this.creatorRefererUrl(p);

    const filterParams: Record<string, unknown> = {};
    if (p.categoryList?.length) {
      filterParams.category_list = p.categoryList.map(([parent, child]) => ({
        string_list: [parent, child],
      }));
    }

    const body = JSON.stringify({
      query,
      pagination: { page, size },
      algorithm: 1,
      filter_params: filterParams,
    });

    const res = await this.sessionManager.signAndFetch({
      cookie: p.cookie,
      shopId: p.shopId,
      shopRegion: p.shopRegion,
      apiPath: FIND_PATH,
      body,
      refererUrl,
    });

    if (res.error) {
      throw new InternalServerErrorException(
        `searchCreators sign/fetch failed: ${res.error}`,
      );
    }

    const parsed = this.parseJson(res.body);
    const out = mapSearchResponse(parsed, page, size);
    if (out.items.length === 0) {
      this.logger.warn(
        `searchCreators returned 0 items (page=${page}, size=${size}, query=${JSON.stringify(query)}). ` +
          `Raw body[0..400]=${(res.body ?? '').slice(0, 400)}`,
      );
    }
    return out;
  }

  async getMarketplaceOptions(opts: {
    cookie: string;
    shopId: string;
    shopRegion: string;
  }): Promise<MarketplaceOptionsResult> {
    const refererUrl = this.creatorRefererUrl(opts);
    const body = JSON.stringify({
      option_req_params_list: [1, 2, 3, 4, 5, 6, 7].map((t) => ({
        option_type: t,
      })),
    });

    let res;
    try {
      res = await this.sessionManager.signAndFetch({
        cookie: opts.cookie,
        shopId: opts.shopId,
        shopRegion: opts.shopRegion,
        apiPath: OPTION_PATH,
        body,
        refererUrl,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isSessionDeadError(msg)) throw new TiktokSessionDeadError(msg);
      throw e;
    }

    if (res.error) {
      if (isSessionDeadError(res.error)) {
        throw new TiktokSessionDeadError(res.error);
      }
      throw new InternalServerErrorException(
        `getMarketplaceOptions sign/fetch failed: ${res.error}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(res.body ?? '');
    } catch {
      throw new InternalServerErrorException(
        'getMarketplaceOptions: invalid JSON from TikTok',
      );
    }

    const root = parsed as {
      code?: number;
      message?: string;
      options?: Record<string, { option_list?: unknown[] }>;
    };
    if (isSignRejectedCode(root.code)) {
      throw new TiktokSignRejectedError(
        root.code as number,
        root.message ?? `tiktok_sign_rejected_${root.code}`,
      );
    }
    if (root.code !== 0) {
      throw new TiktokSearchAuthError(
        root.code ?? -1,
        root.message ?? `tiktok_option_code_${root.code}`,
      );
    }

    const opts2 = root.options ?? {};
    const pickList = (key: string): MarketplaceOption[] => {
      const arr = (opts2[key]?.option_list ?? []) as Array<{
        id?: unknown;
        name?: unknown;
      }>;
      return arr
        .filter((x) => typeof x.id === 'string' && typeof x.name === 'string')
        .map((x) => ({ id: String(x.id), name: String(x.name) }));
    };

    const categoryRaw = (opts2['2']?.option_list ?? []) as Array<{
      id?: unknown;
      name?: unknown;
      option_children?: Array<{ id?: unknown; name?: unknown }>;
    }>;
    const category: MarketplaceCategory[] = categoryRaw
      .filter((x) => typeof x.id === 'string' && typeof x.name === 'string')
      .map((x) => ({
        id: String(x.id),
        name: String(x.name),
        option_children: (x.option_children ?? [])
          .filter((c) => typeof c.id === 'string' && typeof c.name === 'string')
          .map((c) => ({ id: String(c.id), name: String(c.name) })),
      }));

    return {
      category,
      brand: pickList('1'),
      priceRange: pickList('3'),
      language: pickList('6'),
    };
  }

  async checkCookie(opts: {
    cookie: string;
    shopId: string;
    shopRegion: string;
  }): Promise<{ alive: boolean; message: string; retryable?: boolean }> {
    const refererUrl = this.creatorRefererUrl(opts);
    const body = JSON.stringify({
      query: '',
      pagination: { page: 0, size: 12 },
      algorithm: 1,
      filter_params: {},
    });

    // KHÔNG chặn ở đây: hasLoginSession chỉ đoán theo tên cookie, đoán sai là
    // báo cookie tốt thành chết. Cứ thử thật rồi lấy kết quả thật.
    if (!hasLoginSession(parseCookieString(opts.cookie))) {
      this.logger.warn(
        `checkCookie: không thấy cookie session theo tên quen thuộc (shop=${opts.shopId}) — vẫn kiểm tra thật`,
      );
    }

    let res: SignedFetchResult;
    try {
      res = await this.sessionManager.signAndFetch({
        cookie: opts.cookie,
        shopId: opts.shopId,
        shopRegion: opts.shopRegion,
        apiPath: FIND_PATH,
        body,
        refererUrl,
      });
    } catch (e) {
      // Bootstrap context throw (cookie chết, browser pool đầy…) — trả về
      // alive=false kèm nguyên văn lý do, thay vì để controller ném 500 rồi UI
      // chỉ hiện "Internal server error".
      return {
        alive: false,
        message: (e instanceof Error ? e.message : String(e)).slice(0, 300),
      };
    }

    if (res.error) {
      // Cắt 300 (không phải 80): thông báo "cookie chưa đăng nhập" kèm hướng dẫn
      // lấy lại cookie dài hơn 80 ký tự, cắt ngắn là mất đúng phần hữu ích nhất.
      return { alive: false, message: res.error.slice(0, 300) };
    }
    if (res.status === 401 || res.status === 403) {
      return { alive: false, message: `http_${res.status}` };
    }
    if (!res.status || res.status >= 400) {
      return { alive: false, message: `http_${res.status ?? 'unknown'}` };
    }

    let parsed: { code?: number; message?: string };
    try {
      parsed = JSON.parse(res.body ?? '') as {
        code?: number;
        message?: string;
      };
    } catch {
      return { alive: false, message: 'invalid_json' };
    }

    const code = parsed?.code;
    const message = parsed?.message ?? '';
    if (code === 0) return { alive: true, message: 'ok' };
    if (isSignRejectedCode(code)) {
      // Chữ ký bị từ chối — pipeline lỗi, KHÔNG kết luận cookie chết. `retryable`
      // để caller (account.service) GIỮ NGUYÊN trạng thái cookie thay vì set dead.
      return {
        alive: false,
        retryable: true,
        message: `sign_rejected_${code} (lỗi ký request, không phải cookie chết — thử lại lượt sau)`,
      };
    }
    return {
      alive: false,
      message: `code_${code ?? 'unknown'}${message ? `:${message.slice(0, 80)}` : ''}`,
    };
  }

  /**
   * Dựng CreatorFullProfile cho danh sách creator vừa tìm được.
   *
   * CRAWLER_ENRICH_PROFILE=false → flatten thẳng thẻ find, KHÔNG gọi /profile:
   * nhanh nhất nhưng 6 cột chỉ có ở /profile sẽ trống (Bio, Ngành chính,
   * Đã cộng tác, Điểm hoàn thành 90d, Video GMV, LIVE GMV).
   *
   * Bật cờ → mỗi creator gọi /profile cho type 1/2/3 rồi gộp. Lỗi 1 creator chỉ
   * làm creator đó thiếu field, không hỏng cả page.
   *
   * GHI CHÚ: các call chạy TUẦN TỰ vì TiktokSessionManager nối tiếp mọi request
   * cùng 1 cookie (1 Page không fetch song song an toàn được). Vì vậy
   * CRAWLER_PROFILE_CONCURRENCY hiện KHÔNG có tác dụng — muốn song song thật
   * phải cấp nhiều Page cho mỗi context.
   */
  async fullProfile(opts: {
    creators: Array<{
      oec_id: string;
      handle?: string | null;
      nickname?: string | null;
      follower_cnt?: number | null;
      categories?: string[];
      gmvMedian?: { value: number | null } | null;
      unitsSold?: number | null;
    }>;
    session: CrawlSession;
    shouldStop?: () => boolean;
  }): Promise<CreatorFullProfile[]> {
    const enrich = (process.env.CRAWLER_ENRICH_PROFILE ?? 'true') !== 'false';
    const delayMs = this.cfg.get<number>('tiktok.defaultDelayMs') ?? 1000;
    const { session } = opts;

    if (!enrich) {
      return opts.creators.map((c) => ({
        creator: {
          oec_id: c.oec_id,
          handle: c.handle ?? null,
          nickname: c.nickname ?? null,
        },
        overview: flattenOverviewFromCard(c),
        top_videos: [],
        trend: [],
      }));
    }

    const results: CreatorFullProfile[] = [];
    let callIdx = 0;

    for (const c of opts.creators) {
      if (opts.shouldStop?.()) break;

      const refererUrl =
        `https://affiliate.tiktok.com/connection/creator/detail` +
        `?cid=${encodeURIComponent(c.oec_id)}` +
        `&pair_source=author_recommend` +
        `&enter_from=affiliate_find_creators` +
        `&query=` +
        `&shop_region=${encodeURIComponent(session.shopRegion)}` +
        `&shop_id=${encodeURIComponent(session.shopId)}`;

      const profileByType: Record<number, unknown> = {};

      for (const t of OVERVIEW_PROFILE_TYPES) {
        if (opts.shouldStop?.()) break;
        callIdx++;
        if (callIdx > 1 && delayMs > 0) await sleep(delayMs);

        const body = JSON.stringify({
          creator_oec_id: c.oec_id,
          profile_types: [t],
        });

        const res = await this.sessionManager.signAndFetch({
          cookie: session.cookie,
          shopId: session.shopId,
          shopRegion: session.shopRegion,
          apiPath: PROFILE_PATH,
          body,
          refererUrl,
        });

        if (res.error) {
          // Lỗi /profile lẻ không hỏng page — creator này chỉ thiếu field.
          this.logger.warn(
            `profile oec=${c.oec_id} type=${t} lỗi: ${res.error.slice(0, 120)}`,
          );
          profileByType[t] = { error: res.error };
          continue;
        }

        profileByType[t] = this.parseJson(res.body);
      }

      // Seed từ thẻ find để bù field mà /profile không trả (hoặc trả rỗng).
      results.push({
        creator: {
          oec_id: c.oec_id,
          handle: c.handle ?? null,
          nickname: c.nickname ?? null,
        },
        overview: flattenOverview(
          {
            oecuid: c.oec_id,
            handle: c.handle ?? null,
            nickname: c.nickname ?? null,
            follower_cnt: c.follower_cnt ?? null,
          },
          profileByType,
        ),
        top_videos: flattenTopVideos({ oecuid: c.oec_id }, profileByType),
        trend: flattenTrend({ oecuid: c.oec_id }, profileByType),
      });
    }

    return results;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private creatorRefererUrl(p: { shopId: string; shopRegion: string }): string {
    return (
      `https://affiliate.tiktok.com/connection/creator` +
      `?shop_region=${encodeURIComponent(p.shopRegion)}` +
      `&shop_id=${encodeURIComponent(p.shopId)}`
    );
  }

  /** Body không phải JSON vẫn giữ nguyên để log chẩn đoán, không throw. */
  private parseJson(body?: string): unknown {
    try {
      return JSON.parse(body ?? '');
    } catch {
      return { _raw: body };
    }
  }
}

// ─── Mapping response ──────────────────────────────────────────────────────

function unwrapValue(field: unknown): unknown {
  if (field == null) return null;
  if (typeof field !== 'object') return field;
  const obj = field as Record<string, unknown>;
  if ('value' in obj) return obj.value;
  return field;
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function pickAvatar(field: unknown): string | null {
  const v = unwrapValue(field);
  if (!v) return null;
  if (typeof v === 'string') return v;
  const o = v as { thumb_url_list?: string[]; url_list?: string[] };
  return o.thumb_url_list?.[0] ?? o.url_list?.[0] ?? null;
}

function pickMoney(field: unknown): {
  value: number | null;
  format: string | null;
  symbol: string | null;
} {
  const v = unwrapValue(field);
  if (!v || typeof v === 'string') {
    return {
      value: null,
      format: typeof v === 'string' ? v : null,
      symbol: null,
    };
  }
  const o = v as {
    value?: number | null;
    format?: string | null;
    symbol?: string | null;
  };
  return {
    value: o.value ?? null,
    format: o.format ?? null,
    symbol: o.symbol ?? null,
  };
}

function pickCategories(field: unknown): string[] {
  const v = unwrapValue(field);
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (x as { name?: string }).name)
    .filter((s): s is string => !!s);
}

function pickTopVideo(field: unknown): unknown {
  const arr = unwrapValue(field);
  if (!Array.isArray(arr) || !arr.length) return null;
  const v = arr[0] as {
    video?: { id?: string; post_url?: string; duration?: number };
    play_cnt?: number;
    like_cnt?: number;
    comment_cnt?: number;
  };
  return {
    videoId: v.video?.id ?? null,
    thumbUrl: v.video?.post_url ?? null,
    durationSec:
      typeof v.video?.duration === 'number' ? v.video.duration : null,
    playCnt: typeof v.play_cnt === 'number' ? v.play_cnt : null,
    likeCnt: typeof v.like_cnt === 'number' ? v.like_cnt : null,
    commentCnt: typeof v.comment_cnt === 'number' ? v.comment_cnt : null,
  };
}

function pickTopGender(field: unknown): { key: string; value: unknown } | null {
  const arr = unwrapValue(field);
  if (!Array.isArray(arr) || !arr.length) return null;
  const top = arr[0] as { key?: string; value?: unknown };
  if (!top.key) return null;
  return { key: top.key, value: top.value ?? null };
}

function pickAges(field: unknown): string[] {
  const arr = unwrapValue(field);
  return Array.isArray(arr)
    ? arr.filter((s): s is string => typeof s === 'string')
    : [];
}

interface NextPaginationRaw {
  has_more?: boolean;
  search_key?: string;
  /** TikTok trả về SỐ (đo thực tế: `"next_item_cursor":0`), không phải chuỗi. */
  next_item_cursor?: number | string;
  next_page?: number;
}

/** Rút con trỏ phân trang từ response (nằm ở root hoặc trong `response`). */
function readNextPagination(parsed: unknown): {
  searchKey?: string;
  nextItemCursor?: string;
  nextPage?: number;
} {
  const root = parsed as {
    next_pagination?: NextPaginationRaw;
    response?: { next_pagination?: NextPaginationRaw };
  };
  const np = root?.next_pagination ?? root?.response?.next_pagination;
  if (!np) return {};
  // next_item_cursor về dưới dạng number → ép sang string để type ổn định.
  // Bản đầu chỉ nhận string nên luôn trả undefined, che mất giá trị thật.
  const cursor = np.next_item_cursor;
  return {
    searchKey: typeof np.search_key === 'string' ? np.search_key : undefined,
    nextItemCursor:
      typeof cursor === 'number' || typeof cursor === 'string'
        ? String(cursor)
        : undefined,
    nextPage: typeof np.next_page === 'number' ? np.next_page : undefined,
  };
}

function mapSearchResponse(
  parsed: unknown,
  page: number,
  size: number,
): SearchCreatorsResult {
  const root = parsed as {
    code?: number;
    message?: string;
    creator_profile_list?: unknown[];
    next_pagination?: NextPaginationRaw;
    pagination?: { has_more?: boolean; total?: number };
    response?: {
      creator_profile_list?: unknown[];
      next_pagination?: NextPaginationRaw;
      pagination?: { has_more?: boolean; total?: number };
    };
  };

  const code = root?.code;
  if (isSignRejectedCode(code)) {
    // Sign/wire bị từ chối — pipeline lỗi, KHÔNG phải cookie chết.
    throw new TiktokSignRejectedError(
      code as number,
      root?.message ?? `tiktok_sign_rejected_${code}`,
    );
  }
  if (typeof code === 'number' && code !== 0) {
    throw new TiktokSearchAuthError(
      code,
      root?.message ?? `tiktok_search_code_${code}`,
    );
  }

  const list =
    root?.creator_profile_list ?? root?.response?.creator_profile_list ?? [];
  const nextPagination =
    root?.next_pagination ?? root?.response?.next_pagination;
  const pagination = root?.pagination ?? root?.response?.pagination;

  const items: SearchCreatorItem[] = list.map((c) => {
    const raw = c as Record<string, unknown>;
    const engagementRaw = toNum(unwrapValue(raw.video_engagement));
    const engagementPercent =
      engagementRaw != null ? Math.round(engagementRaw) / 100 : null;
    return {
      oec_id: String(unwrapValue(raw.creator_oecuid) ?? ''),
      handle: (unwrapValue(raw.handle) as string | null) ?? null,
      nickname: (unwrapValue(raw.nickname) as string | null) ?? null,
      avatar: pickAvatar(raw.avatar),
      selectionRegion:
        (unwrapValue(raw.selection_region) as string | null) ?? null,
      follower_cnt: toNum(unwrapValue(raw.follower_cnt)),
      categories: pickCategories(raw.category),
      gmvRange: unwrapValue(raw.med_gmv_revenue_range) ?? null,
      gmvMedian: pickMoney(raw.med_gmv_revenue),
      unitsSold: toNum(unwrapValue(raw.units_sold)),
      unitsSoldRange: unwrapValue(raw.units_sold_range) ?? null,
      avgViewCnt: toNum(unwrapValue(raw.video_avg_view_cnt)),
      engagementRaw,
      engagementPercent,
      topGender: pickTopGender(raw.top_follower_gender),
      topAgeRanges: pickAges(raw.top_follower_ages),
      topVideo: pickTopVideo(raw.top_video_data),
      isOpenAccount: unwrapValue(raw.is_open_account) ?? null,
      isOfficialRecommend: unwrapValue(raw.is_official_recommend) ?? null,
    };
  });

  // has_more thật > pagination.total > suy đoán "page đầy = còn nữa".
  const hasMore =
    nextPagination?.has_more === true ||
    pagination?.has_more === true ||
    (typeof pagination?.total === 'number'
      ? (page + 1) * size < pagination.total
      : items.length === size);

  return { page, size, total: pagination?.total, hasMore, items };
}
