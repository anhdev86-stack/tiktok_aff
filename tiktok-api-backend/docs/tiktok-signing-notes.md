# TikTok Web Signing Notes

Ghi chú từ probe 2026-04-26. Update khi có dữ liệu mới.

## X-Bogus: v1 vs v2

| | v1 | v2 |
|---|---|---|
| Độ dài | **28 chars** | **16 chars** |
| Ví dụ | `DFSzswSLx-UANa0nCbP2Bt9WcBr7` | `f0DbKbEp4aQG9mxo` |
| Sign source | npm `xbogus@1.0.2` (pure-JS Node) | `byted_acrawler.frontierSign(path)` trong `webmssdk.js` (cần page hoặc jsdom + secsdk + webmssdk) |
| Sign cost | ~2-5ms (Node thuần) | ~20-30ms (page.evaluate) |
| Input | full URL + UA | path + query (KHÔNG có host) |
| Return | string (chính là X-Bogus) | object `{ 'X-Bogus': '...', 'X-Gnarly'?: '...' }` |

### Cách sign

**v1 (pure-JS, nhanh):**
```js
import xbogus from 'xbogus';
const xb = xbogus(fullUrl, UA); // 28 chars
const signedUrl = `${fullUrl}&X-Bogus=${encodeURIComponent(xb)}`;
```

**v2 (qua puppeteer page):**
```js
// Sau khi addScriptTag secsdk-lastest.umd.js + webmssdk.js
const fs = await page.evaluate(p => window.byted_acrawler.frontierSign(p), pathWithQuery);
// fs = { 'X-Bogus': 'f0DbKbEp4aQG9mxo' }   // 16 chars
```

**v2 (qua jsdom — pure Node, không cần Chrome):** ✅ CONFIRMED 2026-04-26
```js
// Boot: ~1.6s (eval 2 SDK + init wait 1.5s)
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'https://www.tiktok.com/', userAgent: UA, runScripts: 'dangerously', pretendToBeVisual: true,
});
const win = dom.window as any;
for (const k of ['fetch','crypto','TextEncoder','TextDecoder','Request','Response','Headers']) {
  if (globalThis[k] && !win[k]) win[k] = globalThis[k];
}
win.eval(secsdkSrc); win.eval(webmssdkSrc);
await new Promise(r => setTimeout(r, 1500));   // init wait
const sig = win.byted_acrawler.frontierSign(pathWithQuery);
// → { 'X-Bogus': '6hAi4UEkGU2tZAR6' }
```
- **Cost sau boot: ~0.15ms/sign** (bench 100 sign = 15ms). Gấp ~100x nhanh hơn page.evaluate.
- Probe: `D:/tiktok-api/tiktok-api-backend/scripts/probe-jsdom-sign.ts`

## Endpoint compat (đã probe)

| Endpoint | v1 nhận? | v2 nhận? | X-Gnarly cần? | jsdom sign + curl fire? | Ghi chú |
|---|---|---|---|---|---|
| `www.tiktok.com/api/comment/publish/` | ✅ | ✅ | ❌ | ✅ work (status_code:0) | xbogus pure-JS đủ. `comment-fast.js` ~685ms wall |
| `www.tiktok.com/api/user/detail/` | ❌ | ✅ | ❌ | ❌ body=0, header `tt-ticket-guard-result:0` | In-page fetch (puppeteer) work body=2388. Wire mismatch |
| `affiliate.tiktok.com/api/v1/oec/.../marketplace/find` | — | ✅ (sign) | ❌ | ❌ HTTP 200 body=`{"code":100000}` | Puppeteer cùng cookie work body=152KB → cookie+sign OK. Wire layer khác |
| `affiliate.tiktok.com/api/v1/oec/.../marketplace/profile` | — | ✅ (sign) | ❌ | ❌ HTTP 200 body=`{"code":100000}` | Same as find |

### Pattern wire-strictness (probe 2026-04-26)
- **Lỏng** (curl-impersonate work): `www.tiktok.com/api/comment/*`
- **Siết** (curl-impersonate fail): `www.tiktok.com/api/user/*`, mọi endpoint `affiliate.tiktok.com/api/*`
- Trong nhóm "siết", TikTok reject 2 cách khác nhau:
  - `/user/detail/` → body=0, header `tt-ticket-guard-result: 0`
  - `/marketplace/*` → body=15B `{"code":100000}`, không có TT-tg-result header
  - → Hai cơ chế anti-bot khác nhau, nhưng cùng nguyên nhân: wire fingerprint không khớp browser thật.

### Wire diff puppeteer vs curl-impersonate cho `/marketplace/find` (probe 2026-04-26)

Probe: `scripts/probe-aff-wire-diff.ts` (CDP `Network.requestWillBeSentExtraInfo`).

**Cookie diff (wire vs file):**
- File `cookie_aff.txt`: 37 cookies, 4096B
- Wire thật của puppeteer: 39-41 cookies, 4285-4769B
- Browser tự thêm: `i18next`, `odin_tt`, `user_oec_info`. Minor — không phải nguyên nhân chính.

**URL diff (THE KILLER):** TikTok affiliate bundle có patcher patch `window.fetch`. Trước khi fire, nó **append vào URL**:
- `msToken=...` mới (refresh từ cookie hiện tại, msToken file đã cũ)
- `X-Bogus=...` (28 chars **v1**) — đè v2 ta sign từ frontierSign
- `X-Gnarly=...` (~270 chars base64) — header sign mới, **KHÔNG sinh được trong jsdom với secsdk + webmssdk standalone**

→ Endpoint affiliate THỰC SỰ cần **X-Bogus v1 + X-Gnarly + msToken tươi**. webmssdk.js standalone chỉ sinh v2 không X-Gnarly. Logic X-Gnarly nằm trong **bundle runtime của trang affiliate**, không phải 3 SDK file ta có.

**Ý nghĩa:** Hai bài toán riêng biệt:
- "TikTok có thể detect TLS không?" → có khi siết (`/user/detail/`, `/marketplace/*`); curl-impersonate Chrome 116 không qua được
- "Sign đủ chưa?" → cho aff: **chưa, thiếu X-Gnarly**

Để tách Chrome khỏi aff: cần locate JS bundle trên `affiliate.tiktok.com` chứa patcher fetch + sinh X-Gnarly, port sang Node hoặc inject vào jsdom. File `webmssdk_ex.js` (508KB) trong api-test KHÔNG chứa logic này (đã grep, chỉ có hook fetch cho analytics). Có thể là `s16.tiktokcdn-us.com/...` hoặc `ztcatt/loader-bundle.js` thấy trong CDN — chưa lấy về để reverse.

## Heuristic chọn version khi gặp endpoint mới

1. Thử v1 trước (rẻ nhất). Nếu ra body có data → xong.
2. Nếu v1 → HTTP 200 body trống → thử v2.
3. Nếu v2 in-page work nhưng v2 qua curl-impersonate vẫn fail → lỗi không phải sign, mà là **cookie wire mismatch hoặc TT-Ticket-Guard injection** (xem mục dưới).

Endpoint nhạy cảm hơn (user/detail, profile, livestream, login...) thường yêu cầu v2. Endpoint cũ/legacy (comment, marketplace) chấp nhận v1.

## X-Gnarly

`frontierSign` đôi khi trả thêm `X-Gnarly` (header sign mới hơn). 3 endpoint đã probe **không cái nào** kích hoạt — `fsResult['X-Gnarly']` đều `undefined`. X-Gnarly thường dùng cho login / captcha / payment / livestream.

## TT-Ticket-Guard (cookie + sign động)

- Cookie `tt_ticket_guard_client_data` chứa keypair EC đã serialize (tự khởi tạo từ trang TikTok).
- Một số endpoint (như `/user/detail/`) có thể yêu cầu request được sign bằng keypair này → header dạng `tt-ticket-guard-*`.
- Thử grep 3 SDK file (`secsdk-lastest.umd.js`, `webmssdk.js`, `webmssdk_ex.js`) **không tìm thấy** logic TTG sign. Logic này có thể nằm trong bundle TikTok runtime tải động (vd `ztcatt/loader-bundle.js` thấy trong CDN path).
- Khi in-page fetch (Case 0b): `window.fetch.toString().length === 34` → fetch CHƯA bị patch, nhưng request vẫn work → khả năng TTG không phải dạng patch fetch, mà do browser tự gắn cookie/header khi gửi request same-origin.

## Files SDK

Đặt trong `D:\tiktok-api\api-test\`:
- `secsdk-lastest.umd.js` (190KB) — base, expose `window.secsdk`, skeleton cho `byted_acrawler`
- `webmssdk.js` (523KB) — install `byted_acrawler.frontierSign`
- `webmssdk_ex.js` (508KB) — extension, hook fetch/XHR cho **analytics** (không phải sign)

## Pure-Node "Path E" cho /comment/publish/

File: `D:\tiktok-api\api-test\src\comment-fast.js`

Stack: `xbogus` (sign) + `@qnaplus/node-curl-impersonate` Chrome 116 (TLS+H2 spoof).
- Sign 2ms + fire ~600ms. Wall ~685ms.
- Không cần puppeteer runtime, không cần inject SDK.
- Áp dụng được cho mọi endpoint accept v1 + không yêu cầu TTG sign động.

## TODO khi có dữ liệu mới

- [ ] Probe `/aweme/post/` (timeline) → v1 hay v2?
- [ ] Probe `/comment/list/` → v1 hay v2?
- [ ] Reverse `ztcatt/loader-bundle.js` để xem có TTG sign không, port sang Node nếu được.
- [ ] Diff wire request giữa in-page fetch (✅) vs curl-impersonate (❌) cho `/user/detail/` để xác định header/cookie nào thiếu.
