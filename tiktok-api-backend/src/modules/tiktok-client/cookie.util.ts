/**
 * cookie.util — parse chuỗi cookie thô (copy từ DevTools) sang dạng puppeteer.
 *
 * KHÔI PHỤC: file này được dịch ngược từ `dist/` của image production
 * `hecatechvn/tiktok-api-backend:latest` (build 2026-06-28) sau khi source gốc
 * bị mất (thư mục nằm trong .gitignore nên chưa từng được commit).
 */

/** Cookie theo shape puppeteer `CookieParam` — đủ field để `context.setCookie`. */
export interface CookieEntry {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
}

/**
 * Parse "k=v; k2=v2" → CookieEntry[] gắn domain `.tiktok.com`.
 *
 * Dùng Map nên cookie trùng tên thì bản SAU thắng — chuỗi copy từ trình duyệt
 * hay có `msToken` xuất hiện 2 lần, lấy cái cuối mới đúng cái đang hiệu lực.
 * Giá trị KHÔNG trim (cookie có thể chứa khoảng trắng có nghĩa), chỉ trim tên.
 */
export function parseCookieString(raw: string): CookieEntry[] {
  const seen = new Map<string, string>();
  for (const part of raw.trim().split(/;\s*/)) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1);
    if (!name) continue;
    seen.set(name, value);
  }
  return [...seen.entries()].map(([name, value]) => ({
    name,
    value,
    domain: '.tiktok.com',
    path: '/',
    httpOnly: false,
    secure: true,
  }));
}

/** Lấy value của 1 cookie theo tên; null nếu không có. */
export function pickCookie(
  cookies: CookieEntry[],
  name: string,
): string | null {
  return cookies.find((c) => c.name === name)?.value ?? null;
}

/**
 * Cookie chứng minh ĐÃ ĐĂNG NHẬP. Đều là httpOnly nên `document.cookie` KHÔNG
 * trả về chúng — đây chính là cái bẫy khiến người dùng dán cookie thiếu session.
 */
const LOGIN_COOKIE_NAMES = [
  'sessionid',
  'sessionid_ss',
  'sid_tt',
  'sid_guard',
  'sid_ucp_v1',
];

/**
 * Cookie có token đăng nhập thật hay không.
 *
 * `msToken` KHÔNG tính: nó chỉ là token chống bot, có mặt cả khi chưa login.
 * Thiếu login cookie thì TikTok redirect affiliate.tiktok.com → seller.tiktok.com
 * (trang marketing), trang đó không nạp SDK ký request nên lỗi hiện ra dưới dạng
 * "byted_acrawler missing" — rất dễ chẩn đoán sai thành lỗi SDK.
 */
export function hasLoginSession(cookies: CookieEntry[]): boolean {
  return cookies.some(
    (c) => LOGIN_COOKIE_NAMES.includes(c.name) && c.value.trim() !== '',
  );
}

/**
 * Thông báo hướng dẫn lấy lại cookie đúng cách. Tách riêng để backend, log và
 * UI dùng chung một câu chữ.
 */
export const MISSING_LOGIN_COOKIE_HINT =
  'Cookie thiếu token đăng nhập (sessionid/sid_tt) — các cookie này là httpOnly nên ' +
  'copy bằng document.cookie trong Console sẽ KHÔNG có. Lấy lại: DevTools → tab Network → ' +
  'chọn 1 request tới affiliate.tiktok.com → Headers → Request Headers → copy toàn bộ giá trị "cookie:".';
