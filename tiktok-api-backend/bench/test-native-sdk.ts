/**
 * test-native-sdk.ts — verify page TikTok tự load SDK (không cần addScriptTag).
 *
 * Nếu page native load → bỏ luôn dependency vào secsdk-lastest.umd.js + webmssdk.js
 * trong api-test/, không phải pin version, không cần SDK_DIR.
 */
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, Page } from 'puppeteer';
import { parseCookieString, pickCookie } from '../src/modules/tiktok-client/cookie.util';
import { buildBaseQuery, TIKTOK_UA } from '../src/modules/tiktok-client/tiktok-browser';

puppeteerExtra.use(StealthPlugin());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loadCookie(): Promise<string> {
  if (process.env.TIKTOK_COOKIE) return process.env.TIKTOK_COOKIE;
  return (await fs.readFile(resolve(__dirname, '../../api-test/cookie_aff.txt'), 'utf8')).trim();
}

async function waitForSDK(page: Page, timeoutMs = 15000): Promise<number> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const ok = await page.evaluate(
      () =>
        typeof (window as unknown as { byted_acrawler?: { frontierSign?: unknown } })
          .byted_acrawler?.frontierSign === 'function',
    );
    if (ok) return Date.now() - t0;
    await sleep(100);
  }
  return -1;
}

async function main() {
  const cookieRaw = await loadCookie();
  const cookies = parseCookieString(cookieRaw);
  const msToken = pickCookie(cookies, 'msToken')!;
  const shopId = process.env.SHOP_ID ?? '7495155952483076181';
  const shopRegion = 'VN';
  const refererUrl = `https://affiliate.tiktok.com/connection/creator?shop_region=${shopRegion}&shop_id=${shopId}`;

  const browser = (await puppeteerExtra.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', `--user-agent=${TIKTOK_UA}`],
  })) as unknown as Browser;
  const page = await browser.newPage();
  await page.setUserAgent(TIKTOK_UA);
  await page.setBypassCSP(true);
  await page.setViewport({ width: 1920, height: 1080 });

  await (browser as unknown as {
    defaultBrowserContext: () => { setCookie: (...args: unknown[]) => Promise<unknown> };
  })
    .defaultBrowserContext()
    .setCookie(...cookies);

  // Track all script URLs loaded
  const sdkScripts: string[] = [];
  page.on('response', (res) => {
    const u = res.url();
    if (u.includes('secsdk') || u.includes('webmssdk')) {
      sdkScripts.push(`${res.status()} ${u}`);
    }
  });

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const t = req.resourceType();
    if (t === 'image' || t === 'media' || t === 'font') return req.abort();
    return req.continue();
  });

  console.log(`[test] goto refererUrl with domcontentloaded...`);
  const tGoto = Date.now();
  await page.goto(refererUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  console.log(`[test] goto done in ${Date.now() - tGoto}ms`);

  console.log(`[test] waiting for byted_acrawler.frontierSign...`);
  const sdkReadyMs = await waitForSDK(page, 20_000);
  if (sdkReadyMs < 0) {
    console.log(`❌ SDK never ready in 20s`);
  } else {
    console.log(`✅ SDK ready in ${sdkReadyMs}ms after goto`);
  }
  // Đợi SDK init hoàn tất (mssdk-sg call etc.)
  await sleep(3000);

  console.log(`\n[test] Native-loaded SDK scripts:`);
  sdkScripts.forEach((s) => console.log(`  ${s}`));

  // Try sign + fetch to confirm SDK works
  if (sdkReadyMs >= 0) {
    const baseQuery = buildBaseQuery({ shopId, shopRegion, msToken });
    const body = JSON.stringify({ query: '', pagination: { page: 0, size: 12 }, algorithm: 1, filter_params: {} });
    const tSign = Date.now();
    const result = await page.evaluate(
      async (payload: { bq: string; body: string; ref: string }) => {
        const fullPath = `/api/v1/oec/affiliate/creator/marketplace/find?${payload.bq}`;
        const w = window as unknown as { byted_acrawler: { frontierSign: (s: string) => string | Record<string, string> } };
        const r = w.byted_acrawler.frontierSign(fullPath);
        const signed =
          typeof r === 'string'
            ? r
            : `${fullPath}&X-Bogus=${encodeURIComponent((r['X-Bogus'] || r['x-bogus']) as string)}`;
        const res = await fetch(`https://affiliate.tiktok.com${signed}`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            accept: 'application/json, text/plain, */*',
            'content-type': 'application/json',
            origin: 'https://affiliate.tiktok.com',
            referer: payload.ref,
          },
          body: payload.body,
        });
        const text = await res.text();
        try {
          const j = JSON.parse(text) as { code?: number; message?: string };
          return { status: res.status, code: j.code, msg: j.message, len: text.length };
        } catch {
          return { status: res.status, len: text.length };
        }
      },
      { bq: baseQuery, body, ref: refererUrl },
    );
    console.log(`\n[test] sign+fetch in ${Date.now() - tSign}ms: ${JSON.stringify(result)}`);
    if (result.code === 0) {
      console.log(`\n✅✅ NATIVE SDK WORKS — bỏ được addScriptTag + file local!`);
    }
  }

  await browser.close();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(99);
});
