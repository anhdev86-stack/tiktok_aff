/**
 * TiktokSessionManager — pool browser + context, TÁI DÙNG theo cookie.
 *
 * Bootstrap 1 context tốn ~20-30s (goto + chờ SDK). Nếu mỗi request mở lại thì
 * throughput chết. Manager giữ context sống theo từng cookie, request sau dùng
 * lại ngay (~1-2s).
 *
 * Cấu trúc pool: N browser × M context. Context = cookie jar riêng nên nhiều
 * account chạy chung 1 Chrome vẫn không giẫm cookie nhau — rẻ hơn nhiều so với
 * mỗi account 1 Chrome (~300MB/Chrome).
 *
 * Điều phối: mỗi cookie có `chain` promise nối tiếp → request cùng 1 account
 * chạy TUẦN TỰ (1 page không thể fetch song song), account khác nhau chạy song song.
 *
 * KHÔI PHỤC: dịch ngược từ `dist/` image production
 * `hecatechvn/tiktok-api-backend:latest` (build 2026-06-28).
 */
import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Browser } from 'puppeteer';
import {
  buildBaseQuery,
  closeBrowser,
  closeContextSession,
  openBrowser,
  openContextSession,
  readContextCookies,
  signedFetchInPage,
  type BrowserSession,
  type SignedFetchInput,
  type SignedFetchResult,
} from './tiktok-browser';
import { parseCookieString, pickCookie, type CookieEntry } from './cookie.util';

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Context/browser không dùng quá lâu thì đóng để trả RAM. */
const IDLE_CLOSE_MS = 30 * 60 * 1000;
const IDLE_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Lỗi cho thấy page/SDK đã hỏng (không phải lỗi nghiệp vụ) → phải dựng lại
 * context chứ retry trên page cũ vô nghĩa.
 */
const BROKEN_SDK_PATTERN =
  /byted_acrawler missing|Cannot read propert(?:y|ies) of undefined \(reading 'frontierSign'\)|frontierSign is not a function|Target closed|Session closed|TargetCloseError|Execution context was destroyed|detached Frame|Protocol error|Runtime\.callFunctionOn timed out/i;

const DEFAULT_MAX_BROWSERS = 20;
const DEFAULT_MAX_CTX_PER_BROWSER = 50;

interface BrowserSlot {
  browser: Browser;
  contextCount: number;
  spawnedAt: number;
  lastUsedAt: number;
}

interface ContextSlot {
  browserSlot: BrowserSlot | null;
  session: BrowserSession | null;
  bootPromise: Promise<BrowserSession> | null;
  /** Nối tiếp request cùng cookie — 1 page không fetch song song được. */
  chain: Promise<unknown>;
  lastUsedAt: number;
  cookie: string;
  shopId: string;
  shopRegion: string;
  /** Tăng khi cookie đổi → bootstrap đang chạy dở biết mình đã lỗi thời. */
  generation: number;
}

export interface SignAndFetchRequest {
  cookie: string;
  shopId: string;
  shopRegion: string;
  apiPath: string;
  body: string;
  refererUrl?: string;
}

export interface PoolStats {
  browsers: number;
  maxBrowsers: number;
  contexts: number;
  maxContexts: number;
  activeSlots: number;
}

@Injectable()
export class TiktokSessionManager implements OnApplicationShutdown {
  private readonly logger = new Logger(TiktokSessionManager.name);
  private readonly slots = new Map<string, ContextSlot>();
  private readonly browsers: BrowserSlot[] = [];
  private readonly sweepTimer: NodeJS.Timeout;
  private readonly maxBrowsers: number;
  private readonly maxCtxPerBrowser: number;
  private browserSpawnPromise: Promise<BrowserSlot> | null = null;

  constructor(private readonly cfg: ConfigService) {
    const envMaxB = Number(process.env.TIKTOK_MAX_BROWSERS);
    const envMaxC = Number(process.env.TIKTOK_MAX_CTX_PER_BROWSER);
    this.maxBrowsers =
      Number.isFinite(envMaxB) && envMaxB > 0 ? envMaxB : DEFAULT_MAX_BROWSERS;
    this.maxCtxPerBrowser =
      Number.isFinite(envMaxC) && envMaxC > 0
        ? envMaxC
        : DEFAULT_MAX_CTX_PER_BROWSER;

    this.logger.log(
      `Session pool: maxBrowsers=${this.maxBrowsers} maxCtxPerBrowser=${this.maxCtxPerBrowser} ` +
        `(capacity ≈ ${this.maxBrowsers * this.maxCtxPerBrowser} concurrent accounts)`,
    );

    this.sweepTimer = setInterval(
      () => this.sweepIdle(),
      IDLE_SWEEP_INTERVAL_MS,
    );
    this.sweepTimer.unref?.();
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.sweepTimer);
    const ctxClose = Array.from(this.slots.values())
      .filter((s) => s.session)
      .map((s) =>
        s.session
          ? closeContextSession(s.session).catch(() => undefined)
          : undefined,
      );
    this.slots.clear();
    await Promise.all(ctxClose);

    const browserClose = this.browsers.map((b) =>
      closeBrowser(b.browser).catch(() => undefined),
    );
    this.browsers.length = 0;
    await Promise.all(browserClose);
  }

  /**
   * Ký + fetch 1 API path, tái dùng context của cookie này nếu còn sống.
   * Cookie/shop đổi → huỷ context cũ (cookie jar cũ không còn đúng).
   */
  async signAndFetch(req: SignAndFetchRequest): Promise<SignedFetchResult> {
    const slot = this.resolveSlot(req);
    return this.enqueue(slot, () => this.doSignAndFetch(slot, req));
  }

  /**
   * Dựng sẵn context cho cookie này mà không gửi request nghiệp vụ nào.
   *
   * Dùng khi mở "crawl session": chi phí bootstrap (~20-30s) và lỗi cookie chết
   * lộ ra NGAY tại chỗ gọi, thay vì ẩn vào page đầu tiên rồi caller khó phân
   * biệt lỗi bootstrap với lỗi tìm kiếm.
   */
  async warmup(req: {
    cookie: string;
    shopId: string;
    shopRegion: string;
  }): Promise<void> {
    const slot = this.resolveSlot(req);
    await this.enqueue(slot, async () => {
      await this.ensureContextSession(slot);
      slot.lastUsedAt = Date.now();
      if (slot.browserSlot) slot.browserSlot.lastUsedAt = Date.now();
    });
  }

  /**
   * Đọc cookie hiện tại trong context ĐANG SỐNG của cookie này.
   *
   * Trả `[]` khi chưa có context (chưa bootstrap, hoặc đã bị idle sweep đóng) —
   * caller hiểu là "không có gì mới để lưu", không phải lỗi.
   *
   * KHÔNG đi qua `enqueue`: chỉ đọc, không đụng page, nên không cần chờ hàng đợi
   * request của slot. Chờ ở đây có thể kẹt sau một lượt crawl dài.
   */
  async readLiveCookies(req: {
    cookie: string;
    shopId: string;
    shopRegion: string;
  }): Promise<CookieEntry[]> {
    const slot = this.slots.get(this.cookieKey(req.cookie));
    if (!slot?.session) return [];
    return readContextCookies(slot.session);
  }

  /**
   * Lấy (hoặc tạo) slot theo cookie. Nếu cookie/shop đổi so với lần trước thì
   * huỷ context cũ — cookie jar cũ không còn đúng nữa.
   */
  private resolveSlot(req: {
    cookie: string;
    shopId: string;
    shopRegion: string;
  }): ContextSlot {
    const key = this.cookieKey(req.cookie);
    let slot = this.slots.get(key);

    if (!slot) {
      slot = {
        browserSlot: null,
        session: null,
        bootPromise: null,
        chain: Promise.resolve(),
        lastUsedAt: Date.now(),
        cookie: req.cookie,
        shopId: req.shopId,
        shopRegion: req.shopRegion,
        generation: 0,
      };
      this.slots.set(key, slot);
    } else if (
      slot.cookie !== req.cookie ||
      slot.shopId !== req.shopId ||
      slot.shopRegion !== req.shopRegion
    ) {
      slot.generation++;
      slot.bootPromise = null;
      if (slot.session) {
        const old = slot.session;
        const oldBrowser = slot.browserSlot;
        slot.session = null;
        slot.browserSlot = null;
        closeContextSession(old)
          .catch(() => undefined)
          .finally(() => {
            if (oldBrowser) oldBrowser.contextCount--;
          });
      }
      slot.cookie = req.cookie;
      slot.shopId = req.shopId;
      slot.shopRegion = req.shopRegion;
    }

    return slot;
  }

  /** Nối vào chain của slot — chạy dù request trước thành công hay lỗi. */
  private enqueue<T>(slot: ContextSlot, fn: () => Promise<T>): Promise<T> {
    const p = slot.chain.then(fn, fn);
    slot.chain = p.catch(() => undefined);
    return p;
  }

  private async doSignAndFetch(
    slot: ContextSlot,
    req: SignAndFetchRequest,
  ): Promise<SignedFetchResult> {
    const userCookies = parseCookieString(req.cookie);
    const userMsToken = pickCookie(userCookies, 'msToken');
    if (!userMsToken) {
      return { error: 'cookie missing msToken' };
    }

    const baseQuery = buildBaseQuery({
      shopId: req.shopId,
      shopRegion: req.shopRegion,
      msToken: userMsToken,
    });
    const refererUrl =
      req.refererUrl ??
      `https://affiliate.tiktok.com/connection/creator?shop_region=${encodeURIComponent(
        req.shopRegion,
      )}&shop_id=${encodeURIComponent(req.shopId)}`;

    const input: SignedFetchInput = {
      apiPath: req.apiPath,
      baseQuery,
      referer: refererUrl,
      body: req.body,
    };

    // 2 lượt: lượt 1 dùng context sẵn có; nếu SDK hỏng thì dựng lại rồi thử lượt 2.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const session = await this.ensureContextSession(slot);
      slot.lastUsedAt = Date.now();
      if (slot.browserSlot) slot.browserSlot.lastUsedAt = Date.now();

      const res = await signedFetchInPage(session.page, input);
      if (!res.error || !BROKEN_SDK_PATTERN.test(res.error)) {
        return res;
      }

      if (attempt === 1) {
        this.logger.warn(
          `Session shop=${slot.shopId} broken (${res.error.slice(0, 200)}), invalidating + re-bootstrapping`,
        );
        const old = slot.session;
        const oldBrowser = slot.browserSlot;
        slot.session = null;
        slot.browserSlot = null;
        if (old) {
          closeContextSession(old)
            .catch(() => undefined)
            .finally(() => {
              if (oldBrowser) oldBrowser.contextCount--;
            });
        }
      } else {
        this.logger.error(
          `Session shop=${slot.shopId} broken AGAIN sau re-bootstrap (${res.error.slice(0, 200)}). Account/cookie có thể cần refresh.`,
        );
        return res;
      }
    }

    return { error: 'unreachable: doSignAndFetch loop exited without return' };
  }

  /**
   * Khoá định danh account. Ưu tiên sessionid (ổn định) hơn msToken (xoay liên
   * tục) — nếu khoá theo msToken thì mỗi lần TikTok đổi token lại tưởng account
   * mới và bootstrap lại từ đầu.
   */
  private cookieKey(cookie: string): string {
    const c = parseCookieString(cookie);
    return (
      pickCookie(c, 'sessionid') ??
      pickCookie(c, 'sid_tt') ??
      pickCookie(c, 'msToken')?.slice(0, 32) ??
      cookie.slice(0, 64)
    );
  }

  private async ensureContextSession(
    slot: ContextSlot,
  ): Promise<BrowserSession> {
    if (slot.session && Date.now() - slot.lastUsedAt < IDLE_CLOSE_MS) {
      return slot.session;
    }
    // Bootstrap đang chạy → bám vào cùng promise, không dựng 2 context.
    if (slot.bootPromise) return slot.bootPromise;

    if (slot.session) {
      const old = slot.session;
      const oldBrowser = slot.browserSlot;
      slot.session = null;
      slot.browserSlot = null;
      closeContextSession(old)
        .catch(() => undefined)
        .finally(() => {
          if (oldBrowser) oldBrowser.contextCount--;
        });
    }

    const gen = slot.generation;
    slot.bootPromise = this.bootContext(slot)
      .then((s) => {
        // Cookie đổi giữa chừng → session vừa dựng đã sai, vứt đi.
        if (slot.generation !== gen) {
          closeContextSession(s).catch(() => undefined);
          const host = this.browsers.find((b) => b.browser === s.browser);
          if (host) host.contextCount--;
          if (slot.browserSlot === host) slot.browserSlot = null;
          throw new Error(
            'cookie changed during bootstrap — bỏ session cookie cũ',
          );
        }
        slot.session = s;
        slot.lastUsedAt = Date.now();
        return s;
      })
      .finally(() => {
        slot.bootPromise = null;
      });

    return slot.bootPromise;
  }

  private async bootContext(slot: ContextSlot): Promise<BrowserSession> {
    const refererUrl =
      `https://affiliate.tiktok.com/connection/creator` +
      `?shop_region=${encodeURIComponent(slot.shopRegion)}` +
      `&shop_id=${encodeURIComponent(slot.shopId)}`;

    const maxAttempts = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const t0 = Date.now();
      let browserSlot: BrowserSlot | null = null;
      try {
        browserSlot = await this.acquireBrowserSlot();
        const session = await openContextSession(
          browserSlot.browser,
          {
            cookie: slot.cookie,
            shopId: slot.shopId,
            shopRegion: slot.shopRegion,
            refererUrl,
          },
          this.logger,
        );
        browserSlot.lastUsedAt = Date.now();
        slot.browserSlot = browserSlot;
        this.logger.log(
          `Context ready shop=${slot.shopId} in ${Date.now() - t0}ms ` +
            `(attempt ${attempt}, browser ctx count=${browserSlot.contextCount}/${this.maxCtxPerBrowser})`,
        );
        return session;
      } catch (e) {
        // Trả lại chỗ đã chiếm, nếu không pool sẽ rò dần tới lúc báo đầy giả.
        if (browserSlot) browserSlot.contextCount--;
        lastError = e;
        const msg = e instanceof Error ? e.message : String(e);
        if (attempt < maxAttempts) {
          this.logger.warn(
            `Bootstrap context shop=${slot.shopId} attempt ${attempt}/${maxAttempts} fail: ${msg.slice(0, 160)} — retry sau ${attempt}s`,
          );
          await sleep(attempt * 1000);
        }
      }
    }

    const msg =
      lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(
      `Bootstrap context shop=${slot.shopId} fail sau ${maxAttempts} attempts: ${msg.slice(0, 200)}`,
    );
  }

  /** Chọn browser ít context nhất còn chỗ; hết chỗ thì spawn thêm. */
  private async acquireBrowserSlot(): Promise<BrowserSlot> {
    let best: BrowserSlot | null = null;
    for (const b of this.browsers) {
      if (b.contextCount >= this.maxCtxPerBrowser) continue;
      if (!best || b.contextCount < best.contextCount) best = b;
    }
    if (best) {
      best.contextCount++;
      return best;
    }

    if (this.browsers.length >= this.maxBrowsers) {
      throw new Error(
        `Browser pool đầy (${this.browsers.length}/${this.maxBrowsers} browsers, mỗi browser ${this.maxCtxPerBrowser} contexts đã max). ` +
          `Tăng TIKTOK_MAX_BROWSERS hoặc đợi context idle close.`,
      );
    }

    // Đang có lệnh spawn → chờ nó xong rồi xét lại, tránh spawn thừa Chrome.
    if (this.browserSpawnPromise) {
      await this.browserSpawnPromise.catch(() => undefined);
      return this.acquireBrowserSlot();
    }

    this.browserSpawnPromise = this.spawnBrowser().finally(() => {
      this.browserSpawnPromise = null;
    });
    const spawned = await this.browserSpawnPromise;
    spawned.contextCount++;
    return spawned;
  }

  private async spawnBrowser(): Promise<BrowserSlot> {
    const headless = this.cfg.get<boolean>('tiktok.headless') !== false;
    const chromiumPath = this.cfg.get<string>('tiktok.chromiumPath');
    const t0 = Date.now();
    this.logger.log(
      `Spawning browser ${this.browsers.length + 1}/${this.maxBrowsers}...`,
    );
    const browser = await openBrowser({ headless, chromiumPath });
    const slot: BrowserSlot = {
      browser,
      contextCount: 0,
      spawnedAt: Date.now(),
      lastUsedAt: Date.now(),
    };
    this.browsers.push(slot);
    browser.on('disconnected', () => this.handleBrowserDisconnect(slot));
    this.logger.log(
      `Browser ${this.browsers.length}/${this.maxBrowsers} ready in ${Date.now() - t0}ms`,
    );
    return slot;
  }

  /** Chrome chết (OOM…) → gỡ khỏi pool + đánh dấu context của nó phải dựng lại. */
  private handleBrowserDisconnect(crashed: BrowserSlot): void {
    const idx = this.browsers.indexOf(crashed);
    if (idx >= 0) this.browsers.splice(idx, 1);

    let invalidated = 0;
    for (const slot of this.slots.values()) {
      if (slot.browserSlot === crashed) {
        slot.session = null;
        slot.browserSlot = null;
        slot.bootPromise = null;
        slot.generation++;
        invalidated++;
      }
    }
    this.logger.warn(
      `Browser disconnected (đang giữ ${crashed.contextCount} ctx) — gỡ khỏi pool, ` +
        `invalidated ${invalidated} context slot sẽ re-bootstrap ở request kế`,
    );
  }

  private sweepIdle(): void {
    const now = Date.now();
    for (const [, slot] of this.slots) {
      if (!slot.session || slot.bootPromise) continue;
      if (now - slot.lastUsedAt < IDLE_CLOSE_MS) continue;
      const old = slot.session;
      const oldBrowser = slot.browserSlot;
      slot.session = null;
      slot.browserSlot = null;
      this.logger.log(
        `Closing idle context shop=${slot.shopId} (idle ${Math.round((now - slot.lastUsedAt) / 60000)}min)`,
      );
      closeContextSession(old)
        .catch(() => undefined)
        .finally(() => {
          if (oldBrowser) oldBrowser.contextCount--;
        });
    }

    for (let i = this.browsers.length - 1; i >= 0; i--) {
      const b = this.browsers[i];
      if (b.contextCount > 0) continue;
      if (now - b.lastUsedAt < IDLE_CLOSE_MS) continue;
      this.logger.log(
        `Closing empty browser (idle ${Math.round((now - b.lastUsedAt) / 60000)}min, was spawned ${Math.round((now - b.spawnedAt) / 60000)}min ago)`,
      );
      this.browsers.splice(i, 1);
      closeBrowser(b.browser).catch(() => undefined);
    }
  }

  poolStats(): PoolStats {
    const contexts = this.browsers.reduce((s, b) => s + b.contextCount, 0);
    return {
      browsers: this.browsers.length,
      maxBrowsers: this.maxBrowsers,
      contexts,
      maxContexts: this.maxBrowsers * this.maxCtxPerBrowser,
      activeSlots: Array.from(this.slots.values()).filter((s) => s.session)
        .length,
    };
  }
}
