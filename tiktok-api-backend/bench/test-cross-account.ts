/**
 * test-cross-account.ts — câu hỏi quyết định kiến trúc:
 *
 *   "1 master session goto aff page với cookie A, init SDK đầy đủ. Có thể sign URL
 *    với msToken_B (khác A) và fetch với cookies B → server accept không?"
 *
 * Nếu YES → 1 master sign cho N account → cực rẻ scale
 * Nếu NO  → cần N session (1 per account)
 *
 * 3 modes:
 *   M1) baseline same-user: cookie A inject + sign URL msToken_A + fetch cookie A
 *   M2) cross-user: cookie A inject (master) + sign URL msToken_A + fetch with cookie A
 *       → control: phải = baseline (sanity)
 *   M3) DECISIVE: cookie A inject + sign URL with msToken_B + fetch with cookie B
 *       → nếu code=0 → master pattern khả thi
 *
 * Yêu cầu: 2 cookie file, default ../api-test/cookie_aff.txt + ../api-test/cookie_aff_2.txt
 */
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, Page } from 'puppeteer';
import {
  parseCookieString,
  pickCookie,
  type CookieEntry,
} from '../src/modules/tiktok-client/cookie.util';
import { buildBaseQuery, TIKTOK_UA } from '../src/modules/tiktok-client/tiktok-browser';

puppeteerExtra.use(StealthPlugin());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loadCookie(file: string): Promise<string | null> {
  try {
    return (await fs.readFile(file, 'utf8')).trim();
  } catch {
    return null;
  }
}

async function bootstrap(opts: {
  injectCookies: CookieEntry[];
  refererUrl: string;
  headless: boolean;
}): Promise<{ browser: Browser; page: Page; bootMs: number }> {
  const t0 = Date.now();
  const browser = (await puppeteerExtra.launch({
    headless: opts.headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      `--user-agent=${TIKTOK_UA}`,
    ],
  })) as unknown as Browser;
  const page = await browser.newPage();
  await page.setBypassCSP(true);
  await page.setUserAgent(TIKTOK_UA);
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9,vi;q=0.8' });

  await (browser as unknown as {
    defaultBrowserContext: () => { setCookie: (...args: unknown[]) => Promise<unknown> };
  })
    .defaultBrowserContext()
    .setCookie(...opts.injectCookies);

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const t = req.resourceType();
    if (t === 'image' || t === 'media' || t === 'font') return req.abort();
    return req.continue();
  });

  await page.goto(opts.refererUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
  // Đợi page native load webmssdk.js từ CDN.
  const t0Sdk = Date.now();
  while (Date.now() - t0Sdk < 15_000) {
    const ok = await page.evaluate(() =>
      typeof (window as unknown as { byted_acrawler?: { frontierSign?: unknown } })
        .byted_acrawler?.frontierSign === 'function');
    if (ok) break;
    await sleep(100);
  }
  await sleep(2500);
  return { browser, page, bootMs: Date.now() - t0 };
}

async function signAndFetch(
  page: Page,
  baseQuery: string,
  body: string,
  refererUrl: string,
): Promise<{ status?: number; respBody?: string; signMs: number; fetchMs: number }> {
  const tSign = Date.now();
  const signed = await page.evaluate((bq: string) => {
    const fullPath = `/api/v1/oec/affiliate/creator/marketplace/find?${bq}`;
    const w = window as unknown as {
      byted_acrawler: { frontierSign: (s: string) => string | Record<string, string> };
    };
    const r = w.byted_acrawler.frontierSign(fullPath);
    return typeof r === 'string' ? r : `${fullPath}&X-Bogus=${encodeURIComponent((r['X-Bogus'] || r['x-bogus']) as string)}`;
  }, baseQuery);
  const signMs = Date.now() - tSign;
  const tFetch = Date.now();
  const r = await page.evaluate(
    async (payload: { signedPath: string; body: string; refererUrl: string }) => {
      try {
        const fullUrl = `https://affiliate.tiktok.com${payload.signedPath}`;
        const res = await fetch(fullUrl, {
          method: 'POST',
          credentials: 'include',
          headers: {
            accept: 'application/json, text/plain, */*',
            'content-type': 'application/json',
            origin: 'https://affiliate.tiktok.com',
            referer: payload.refererUrl,
          },
          body: payload.body,
        });
        return { status: res.status, body: await res.text() };
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
    { signedPath: signed, body, refererUrl },
  );
  const fetchMs = Date.now() - tFetch;
  return { status: r.status, respBody: r.body, signMs, fetchMs };
}

function parseCode(body?: string): { code?: number; msg?: string; len: number } {
  if (!body) return { len: 0 };
  try {
    const j = JSON.parse(body) as { code?: number; message?: string };
    return { code: j.code, msg: j.message, len: body.length };
  } catch {
    return { len: body.length };
  }
}

async function swapCookies(browser: Browser, oldCookies: CookieEntry[], newCookies: CookieEntry[]) {
  const ctx = (browser as unknown as {
    defaultBrowserContext: () => {
      cookies: () => Promise<CookieEntry[]>;
      deleteCookie: (...args: unknown[]) => Promise<unknown>;
      setCookie: (...args: unknown[]) => Promise<unknown>;
    };
  }).defaultBrowserContext();
  // Delete old cookies
  await ctx.deleteCookie(...oldCookies);
  await ctx.setCookie(...newCookies);
}

async function main() {
  const sdkDir = process.env.SDK_DIR ?? resolve(__dirname, '../../api-test');
  const headless = process.env.HEADLESS !== '0';
  const cookieFileA = process.env.COOKIE_A ?? resolve(__dirname, '../../api-test/cookie_aff.txt');
  const cookieFileB = process.env.COOKIE_B ?? resolve(__dirname, '../../api-test/cookie_aff_2.txt');
  const shopId = process.env.SHOP_ID ?? '7495155952483076181';
  const shopRegion = process.env.SHOP_REGION ?? 'VN';

  const cookieRawA = await loadCookie(cookieFileA);
  const cookieRawB = await loadCookie(cookieFileB);
  if (!cookieRawA) throw new Error(`Missing cookie A: ${cookieFileA}`);

  const cookiesA = parseCookieString(cookieRawA);
  const msTokenA = pickCookie(cookiesA, 'msToken')!;

  const refererUrl = `https://affiliate.tiktok.com/connection/creator?shop_region=${shopRegion}&shop_id=${shopId}`;
  const baseQueryA = buildBaseQuery({ shopId, shopRegion, msToken: msTokenA });
  const body = JSON.stringify({ query: '', pagination: { page: 0, size: 12 }, algorithm: 1, filter_params: {} });

  console.log(`=== Cross-account sign test ===`);
  console.log(`Cookie A: ${cookieFileA}`);
  console.log(`Cookie B: ${cookieFileB} (exists: ${!!cookieRawB})`);

  // ─── Bootstrap với cookie A (master session) ───
  console.log(`\n[boot] master session với cookie A...`);
  const { browser, page, bootMs } = await bootstrap({
    injectCookies: cookiesA,
    refererUrl,
    sdkDir,
    headless,
  });
  console.log(`[boot] bootMs=${bootMs}ms`);

  // ─── M1: baseline same-user ───
  console.log(`\n--- M1: baseline (cookie A bootstrap, msToken A in URL, cookie A at fetch) ---`);
  const m1 = await signAndFetch(page, baseQueryA, body, refererUrl);
  const p1 = parseCode(m1.respBody);
  console.log(`[M1] sign=${m1.signMs}ms fetch=${m1.fetchMs}ms HTTP=${m1.status} code=${p1.code} len=${p1.len}`);

  // ─── M3: cross-account decisive test ───
  if (cookieRawB) {
    const cookiesB = parseCookieString(cookieRawB);
    const msTokenB = pickCookie(cookiesB, 'msToken');
    const shopIdB = process.env.SHOP_ID_B ?? pickCookie(cookiesB, 'SHOP_ID') ?? shopId;
    if (!msTokenB) {
      console.log(`Cookie B missing msToken, skip M3`);
    } else {
      const baseQueryB = buildBaseQuery({ shopId: shopIdB, shopRegion, msToken: msTokenB });
      const refererUrlB = `https://affiliate.tiktok.com/connection/creator?shop_region=${shopRegion}&shop_id=${shopIdB}`;
      console.log(`\n--- M3: DECISIVE (cookie A bootstrap, shop+msToken B in URL, fetch with cookies B) ---`);
      console.log(`[M3] shop_A=${shopId} shop_B=${shopIdB}`);
      console.log(`[M3] sign with msToken B, then swap cookies A → B`);

      // Sign in master (still cookie A)
      const tSign = Date.now();
      const signed = await page.evaluate((bq: string) => {
        const fullPath = `/api/v1/oec/affiliate/creator/marketplace/find?${bq}`;
        const w = window as unknown as { byted_acrawler: { frontierSign: (s: string) => string | Record<string, string> } };
        const r = w.byted_acrawler.frontierSign(fullPath);
        return typeof r === 'string' ? r : `${fullPath}&X-Bogus=${encodeURIComponent((r['X-Bogus'] || r['x-bogus']) as string)}`;
      }, baseQueryB);
      const signMs = Date.now() - tSign;

      // Swap cookies A → B
      await swapCookies(browser, cookiesA, cookiesB);

      // Fetch with cookies B
      const tFetch = Date.now();
      const r = await page.evaluate(
        async (payload) => {
          try {
            const res = await fetch(`https://affiliate.tiktok.com${payload.signedPath}`, {
              method: 'POST',
              credentials: 'include',
              headers: {
                accept: 'application/json, text/plain, */*',
                'content-type': 'application/json',
                origin: 'https://affiliate.tiktok.com',
                referer: payload.refererUrl,
              },
              body: payload.body,
            });
            return { status: res.status, body: await res.text() };
          } catch (e) {
            return { error: (e as Error).message };
          }
        },
        { signedPath: signed, body, refererUrl: refererUrlB },
      );
      const fetchMs = Date.now() - tFetch;
      const p3 = parseCode(r.body);
      console.log(`[M3] sign=${signMs}ms fetch=${fetchMs}ms HTTP=${r.status} code=${p3.code} msg=${p3.msg?.slice(0, 100)} len=${p3.len}`);

      if (p3.code === 0) {
        console.log(`\n✅✅✅ MASTER PATTERN VIABLE: 1 master session sign cho N account!`);
        console.log(`   → Architecture: 1 browser persistent + N cookie swap layers`);
        console.log(`   → RAM: ~1 chrome (~300MB) thay vì N chrome (~1k × 300MB = 300GB)`);
      } else {
        console.log(`\n❌ Master pattern NOT viable: cần 1 session per account`);
      }
    }
  } else {
    console.log(`\n[M3] SKIPPED: cookie B file không tồn tại tại ${cookieFileB}`);
    console.log(`     Cách tạo: copy 1 cookie account khác vào ${cookieFileB} rồi chạy lại`);
  }

  await browser.close().catch(() => undefined);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(99);
});
