/**
 * bench-current.ts — đo baseline pipeline hiện tại (`searchCreators`).
 *
 * Modes:
 *   A) "current"  — launch + goto + injectSDK + sign + fetch + close (mỗi call full)
 *   B) "reuse"    — launch + goto + injectSDK 1 lần, sign+fetch N call, close 1 lần
 *
 * Mục tiêu: xác định cost từng phase + tiết kiệm khi reuse session.
 *
 * Run:
 *   TIKTOK_COOKIE="$(cat ../api-test/cookie_aff.txt)" \
 *   SHOP_ID=7495155952483076181 SHOP_REGION=VN \
 *   npx tsx bench/bench-current.ts
 */
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import {
  openBrowserSession,
  signedFetchInPage,
  closeSession,
  type BrowserSession,
} from '../src/modules/tiktok-client/tiktok-browser';

const FIND_PATH = '/api/v1/oec/affiliate/creator/marketplace/find';

interface PhaseTimes {
  total: number;
  bootstrap?: number;  // launch + goto + injectSDK
  sign?: number;       // signedFetchInPage
  close?: number;
}

const logger = new Logger('bench');

async function loadCookie(): Promise<string> {
  if (process.env.TIKTOK_COOKIE) return process.env.TIKTOK_COOKIE;
  const fallback = resolve(__dirname, '../../api-test/cookie_aff.txt');
  return (await fs.readFile(fallback, 'utf8')).trim();
}

function p50p95(arr: number[]): { p50: number; p95: number; avg: number; min: number; max: number } {
  const sorted = [...arr].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1];
  const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return { p50, p95, avg, min: sorted[0], max: sorted[sorted.length - 1] };
}

async function fireSearch(session: BrowserSession, refererUrl: string, page: number): Promise<{ ms: number; status?: number; bodyLen: number }> {
  const body = JSON.stringify({
    query: '',
    pagination: { page, size: 12 },
    algorithm: 1,
    filter_params: {},
  });
  const t0 = Date.now();
  const res = await signedFetchInPage(session.page, {
    apiPath: FIND_PATH,
    baseQuery: session.baseQuery,
    referer: refererUrl,
    body,
  });
  const ms = Date.now() - t0;
  return { ms, status: res.status, bodyLen: res.body?.length ?? 0 };
}

async function modeCurrent(N: number, ctx: BenchCtx): Promise<PhaseTimes[]> {
  const results: PhaseTimes[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = Date.now();
    const session = await openBrowserSession(ctx.opts, logger);
    const tBoot = Date.now() - t0;
    const fire = await fireSearch(session, ctx.refererUrl, i);
    const tCloseStart = Date.now();
    await closeSession(session);
    const tClose = Date.now() - tCloseStart;
    const total = Date.now() - t0;
    console.log(`[A current ${i + 1}/${N}] total=${total}ms boot=${tBoot}ms sign+fetch=${fire.ms}ms close=${tClose}ms status=${fire.status} bodyLen=${fire.bodyLen}`);
    results.push({ total, bootstrap: tBoot, sign: fire.ms, close: tClose });
    await new Promise((r) => setTimeout(r, 1000));
  }
  return results;
}

async function modeReuse(N: number, ctx: BenchCtx): Promise<PhaseTimes[]> {
  const results: PhaseTimes[] = [];
  const t0 = Date.now();
  const session = await openBrowserSession(ctx.opts, logger);
  const bootstrap = Date.now() - t0;
  console.log(`[B reuse] bootstrap=${bootstrap}ms (1 lần duy nhất)`);
  for (let i = 0; i < N; i++) {
    const fire = await fireSearch(session, ctx.refererUrl, i);
    console.log(`[B reuse ${i + 1}/${N}] sign+fetch=${fire.ms}ms status=${fire.status} bodyLen=${fire.bodyLen}`);
    results.push({ total: fire.ms, sign: fire.ms });
    await new Promise((r) => setTimeout(r, 500));
  }
  await closeSession(session);
  return results;
}

interface BenchCtx {
  opts: Parameters<typeof openBrowserSession>[0];
  refererUrl: string;
}

async function main() {
  const cookie = await loadCookie();
  const shopId = process.env.SHOP_ID ?? '7495155952483076181';
  const shopRegion = process.env.SHOP_REGION ?? 'VN';
  const headless = process.env.HEADLESS !== '0';
  const N = Number(process.env.N ?? 3);

  const refererUrl = `https://affiliate.tiktok.com/connection/creator?shop_region=${encodeURIComponent(shopRegion)}&shop_id=${encodeURIComponent(shopId)}`;

  const ctx: BenchCtx = {
    opts: { cookie, shopId, shopRegion, headless, refererUrl },
    refererUrl,
  };

  console.log(`=== Benchmark current pipeline ===`);
  console.log(`N=${N}, headless=${headless}, shop=${shopId}`);

  console.log(`\n--- Mode A: current pattern (launch+close mỗi call) ---`);
  const aResults = await modeCurrent(N, ctx);

  console.log(`\n--- Mode B: reuse single browser session ---`);
  const bResults = await modeReuse(N, ctx);

  console.log(`\n=== Summary ===`);
  const aTotal = p50p95(aResults.map((r) => r.total));
  const aBoot = p50p95(aResults.map((r) => r.bootstrap ?? 0));
  const aSign = p50p95(aResults.map((r) => r.sign ?? 0));
  const bSign = p50p95(bResults.map((r) => r.total));

  console.log(`Mode A (launch+close per call):`);
  console.log(`  total: avg=${aTotal.avg.toFixed(0)}ms p50=${aTotal.p50}ms p95=${aTotal.p95}ms`);
  console.log(`  bootstrap: avg=${aBoot.avg.toFixed(0)}ms`);
  console.log(`  sign+fetch: avg=${aSign.avg.toFixed(0)}ms`);

  console.log(`\nMode B (reuse session):`);
  console.log(`  sign+fetch only: avg=${bSign.avg.toFixed(0)}ms p50=${bSign.p50}ms p95=${bSign.p95}ms min=${bSign.min}ms max=${bSign.max}ms`);

  console.log(`\n>>> Improvement nếu reuse session:`);
  console.log(`  call latency: ${aTotal.avg.toFixed(0)}ms → ${bSign.avg.toFixed(0)}ms (${((1 - bSign.avg / aTotal.avg) * 100).toFixed(1)}% giảm)`);
  console.log(`  throughput estimate (1 tab):`);
  console.log(`    Mode A: ${(1000 / aTotal.avg).toFixed(2)} req/s`);
  console.log(`    Mode B: ${(1000 / bSign.avg).toFixed(2)} req/s`);
  console.log(`  Đạt 1k req/s cần ~${Math.ceil(1000 / (1000 / bSign.avg))} tab concurrent (Mode B)`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(99); });
