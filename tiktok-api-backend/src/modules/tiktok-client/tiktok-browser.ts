/**
 * tiktok-browser — lớp thấp nhất: mở Chrome, nạp cookie, chờ TikTok tự load SDK
 * ký request (`window.byted_acrawler.frontierSign`), rồi fetch NGAY TRONG PAGE.
 *
 * Vì sao fetch trong page thay vì từ Node: request phải mang chữ ký X-Bogus do
 * SDK sinh, mà SDK chỉ chạy được trong ngữ cảnh trang affiliate.tiktok.com với
 * đúng cookie + origin. Fetch từ Node sẽ không qua được kiểm tra chữ ký.
 *
 * SDK KHÔNG cần addScriptTag: page affiliate tự tải webmssdk.js từ CDN khi goto.
 *
 * KHÔI PHỤC: dịch ngược từ `dist/` image production
 * `hecatechvn/tiktok-api-backend:latest` (build 2026-06-28).
 */
import type { Logger } from '@nestjs/common';
import type { Browser, BrowserContext, LaunchOptions, Page } from 'puppeteer';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { parseCookieString, pickCookie } from './cookie.util';

puppeteerExtra.use(StealthPlugin());

/**
 * UA phải khớp `browser_version` trong buildBaseQuery — TikTok đối chiếu UA
 * thật của trình duyệt với tham số query khi verify chữ ký. Đổi 1 chỗ phải đổi
 * cả 2.
 */
export const TIKTOK_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Session gắn với 1 cookie/shop: 1 BrowserContext riêng (cookie jar tách biệt). */
export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  msToken: string;
  baseQuery: string;
  refererUrl: string;
}

export interface SignedFetchInput {
  apiPath: string;
  baseQuery: string;
  referer: string;
  body: string;
}

export interface SignedFetchResult {
  status?: number;
  body?: string;
  error?: string;
  raw?: string;
}

/**
 * Bộ query param cố định TikTok đòi trên MỌI request affiliate. Thiếu/sai 1
 * tham số là server trả code != 0 dù chữ ký đúng.
 *
 * `oec_seller_id` = shop id (KHÔNG phải `shop_id`), `msToken` lấy từ cookie.
 */
export function buildBaseQuery(p: {
  shopId: string;
  shopRegion: string;
  msToken: string;
}): string {
  const params = new URLSearchParams({
    user_language: 'vi-VN',
    aid: '4331',
    app_name: 'i18n_ecom_alliance',
    device_id: '0',
    device_platform: 'web',
    cookie_enabled: 'true',
    screen_width: '1920',
    screen_height: '1080',
    browser_language: 'en-US',
    browser_platform: 'Win32',
    browser_name: 'Mozilla',
    browser_version:
      '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    browser_online: 'true',
    timezone_name: 'Asia/Saigon',
    oec_seller_id: p.shopId,
    shop_region: p.shopRegion,
    msToken: p.msToken,
  });
  return params.toString();
}

/** Poll tới khi SDK ký sẵn sàng. Trả ms đã chờ, -1 nếu quá hạn. */
async function waitForFrontierSign(
  page: Page,
  timeoutMs: number,
): Promise<number> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const ok = await page.evaluate(
      () =>
        typeof (
          window as unknown as {
            byted_acrawler?: { frontierSign?: unknown };
          }
        ).byted_acrawler?.frontierSign === 'function',
    );
    if (ok) return Date.now() - t0;
    await sleep(100);
  }
  return -1;
}

/**
 * Mở 1 Chrome dùng chung cho NHIỀU context. Cờ launch cắt hết thứ không cần
 * (background networking, extension, sync…) để giảm RAM khi chạy nhiều tab.
 */
export async function openBrowser(opts: {
  headless: boolean;
  chromiumPath?: string;
}): Promise<Browser> {
  const launchOpts: LaunchOptions = {
    headless: opts.headless,
    protocolTimeout: 60_000,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=Translate,BackForwardCache,MediaRouter',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-plugins',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--disable-component-update',
      '--disable-domain-reliability',
      '--disable-client-side-phishing-detection',
      '--no-default-browser-check',
      '--no-first-run',
      '--mute-audio',
      '--js-flags=--max-old-space-size=4096',
      `--user-agent=${TIKTOK_UA}`,
    ],
  };
  if (opts.chromiumPath) {
    launchOpts.executablePath = opts.chromiumPath;
  }
  return (await puppeteerExtra.launch(launchOpts)) as unknown as Browser;
}

/**
 * Tạo BrowserContext riêng cho 1 cookie/shop rồi bootstrap tới lúc ký được.
 *
 * Context riêng = cookie jar riêng → nhiều account chạy song song trong CÙNG 1
 * Chrome mà không giẫm cookie nhau.
 *
 * `sleep(4500)` sau khi frontierSign xuất hiện: SDK còn init tiếp (gọi mssdk-sg)
 * sau khi hàm đã tồn tại; ký sớm quá thì chữ ký bị TikTok từ chối.
 */
export async function openContextSession(
  browser: Browser,
  opts: {
    cookie: string;
    shopId: string;
    shopRegion: string;
    refererUrl: string;
  },
  logger: Logger,
): Promise<BrowserSession> {
  const cookies = parseCookieString(opts.cookie);
  const msToken = pickCookie(cookies, 'msToken');
  if (!msToken) {
    throw new Error('Cookie msToken not found in provided cookie string');
  }

  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    await page.setBypassCSP(true);
    await page.setUserAgent(TIKTOK_UA);
    await page.setExtraHTTPHeaders({
      'accept-language': 'en-US,en;q=0.9,vi;q=0.8',
    });
    await page.setViewport({ width: 1920, height: 1080 });
    await context.setCookie(...cookies);

    // Chặn ảnh/video/font: không cần cho API call, tiết kiệm băng thông + RAM.
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const t = req.resourceType();
      if (t === 'image' || t === 'media' || t === 'font') return req.abort();
      return req.continue();
    });

    const tGoto = Date.now();
    try {
      await page.goto(opts.refererUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
    } catch (e) {
      // goto timeout không nhất thiết fatal — SDK vẫn có thể đã load xong.
      logger.warn(`goto warning: ${(e as Error).message}`);
    }
    logger.debug?.(`goto done in ${Date.now() - tGoto}ms`);

    const sdkReady = await waitForFrontierSign(page, 15_000);
    if (sdkReady < 0) {
      throw new Error(
        'byted_acrawler.frontierSign not ready in 15s after goto',
      );
    }
    await sleep(4500);

    const baseQuery = buildBaseQuery({
      shopId: opts.shopId,
      shopRegion: opts.shopRegion,
      msToken,
    });

    return {
      browser,
      context,
      page,
      msToken,
      baseQuery,
      refererUrl: opts.refererUrl,
    };
  } catch (err) {
    await context.close().catch(() => undefined);
    throw err;
  }
}

/**
 * Ký path bằng SDK rồi fetch — TOÀN BỘ chạy trong page.
 *
 * frontierSign trả 2 shape tuỳ version SDK: string (URL đã ký sẵn) hoặc object
 * {X-Bogus, X-Gnarly} phải tự ghép vào query. Xử lý cả hai.
 *
 * Không throw: mọi lỗi trả về qua field `error` để caller (session manager)
 * phân loại được lỗi SDK hỏng (cần re-bootstrap) với lỗi nghiệp vụ.
 */
export async function signedFetchInPage(
  page: Page,
  input: SignedFetchInput,
): Promise<SignedFetchResult> {
  // Bắt URL thật đi trên dây để log so sánh với URL tự ghép — lệch nhau là
  // dấu hiệu SDK wrap fetch và ký lại theo cách khác.
  let wireUrl: string | null = null;
  const handler = (req: { url: () => string }): void => {
    const u = req.url();
    if (u.includes(input.apiPath)) wireUrl = u;
  };
  page.on('request', handler);

  try {
    const result = await page.evaluate(async (payload: SignedFetchInput) => {
      const fullPathBefore = `${payload.apiPath}?${payload.baseQuery}`;
      const w = window as unknown as {
        byted_acrawler?: {
          frontierSign?: (s: string) => string | Record<string, string>;
        };
      };

      if (
        !w.byted_acrawler ||
        typeof w.byted_acrawler.frontierSign !== 'function'
      ) {
        const diag = {
          url: location.href,
          title: document.title,
          hasByted: typeof w.byted_acrawler !== 'undefined',
          bytedKeys: w.byted_acrawler
            ? Object.keys(w.byted_acrawler).slice(0, 20)
            : null,
          readyState: document.readyState,
        };
        return {
          error: 'byted_acrawler missing on page: ' + JSON.stringify(diag),
        };
      }

      let signed: string | Record<string, string>;
      try {
        signed = w.byted_acrawler.frontierSign(fullPathBefore);
      } catch (e) {
        return { error: 'frontierSign threw: ' + (e as Error).message };
      }

      const signedShape =
        typeof signed === 'string'
          ? `string(len=${signed.length})`
          : signed && typeof signed === 'object'
            ? `object(keys=${Object.keys(signed).join(',')})`
            : `unknown(${typeof signed})`;

      let signedUrl: string;
      if (typeof signed === 'string') {
        signedUrl = signed;
      } else if (signed && (signed['X-Bogus'] || signed['x-bogus'])) {
        const xb = signed['X-Bogus'] || signed['x-bogus'];
        const xg = signed['X-Gnarly'] || signed['x-gnarly'] || '';
        const sep = fullPathBefore.includes('?') ? '&' : '?';
        signedUrl =
          `${fullPathBefore}${sep}X-Bogus=${encodeURIComponent(xb)}` +
          (xg ? `&X-Gnarly=${encodeURIComponent(xg)}` : '');
      } else {
        return {
          error: 'frontierSign unknown shape',
          raw: JSON.stringify(signed),
          signedShape,
        };
      }

      const fullUrl = signedUrl.startsWith('http')
        ? signedUrl
        : `https://affiliate.tiktok.com${signedUrl}`;

      let res: Response | undefined;
      const ctrl = new AbortController();
      const killTimer = setTimeout(() => ctrl.abort(), 30_000);
      try {
        res = await fetch(fullUrl, {
          method: 'POST',
          credentials: 'include',
          headers: {
            accept: 'application/json, text/plain, */*',
            'accept-language': 'en-US,en;q=0.9,vi;q=0.8',
            'content-type': 'application/json',
            origin: 'https://affiliate.tiktok.com',
            referer: payload.referer,
          },
          body: payload.body,
          signal: ctrl.signal,
        });
      } catch (e) {
        return {
          error: 'fetch threw: ' + (e as Error).message,
          signedShape,
          manualSignedUrl: fullUrl,
        };
      } finally {
        clearTimeout(killTimer);
      }

      if (!res) {
        return {
          error: 'fetch returned undefined (SDK wrapper aborted?)',
          signedShape,
          manualSignedUrl: fullUrl,
        };
      }

      const text = await res.text();
      return {
        status: res.status,
        body: text,
        signedShape,
        manualSignedUrl: fullUrl,
      };
    }, input);

    // `as` là cần thiết: wireUrl chỉ được gán trong event handler nên control
    // flow analysis của TS thu hẹp nó về `null` tại đây.
    const wire = wireUrl as string | null;
    const manualHasBogus = result.manualSignedUrl?.includes('X-Bogus=');
    const manualHasGnarly = result.manualSignedUrl?.includes('X-Gnarly=');
    const wireHasBogus = wire?.includes('X-Bogus=');
    const wireHasGnarly = wire?.includes('X-Gnarly=');
    const msTokenMatch = input.baseQuery.match(/msToken=([^&]+)/);
    const msTokenTail = msTokenMatch ? msTokenMatch[1].slice(-12) : 'NONE';

    console.log(
      `[signedFetch] apiPath=${input.apiPath} signedShape=${result.signedShape ?? '?'} ` +
        `manual.X-Bogus=${manualHasBogus} manual.X-Gnarly=${manualHasGnarly} ` +
        `wire.X-Bogus=${wireHasBogus} wire.X-Gnarly=${wireHasGnarly} ` +
        `msToken=...${msTokenTail} ` +
        `status=${result.status} bodyHead=${(result.body ?? '').slice(0, 120)}`,
    );

    return {
      status: result.status,
      body: result.body,
      error: result.error,
      raw: result.raw,
    };
  } catch (e) {
    return { error: `page.evaluate threw: ${(e as Error).message}` };
  } finally {
    page.off('request', handler);
  }
}

export async function closeContextSession(
  session: BrowserSession,
): Promise<void> {
  await session.context.close().catch(() => undefined);
}

export async function closeBrowser(browser: Browser): Promise<void> {
  await browser.close().catch(() => undefined);
}
