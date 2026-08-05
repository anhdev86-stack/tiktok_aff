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
 * trả về chúng — đây là cái bẫy khiến người dùng dán cookie thiếu session.
 *
 * PHẢI khớp theo TIỀN TỐ, không phải tên chính xác: TikTok đặt tên cookie session
 * theo từng sản phẩm nên trên thực tế gặp `sessionid_tiktokseller`,
 * `sessionid_ss_tiktokseller`, `sid_tt_ads`, `sid_guard_tiktokseller`,
 * `ssid_ucp_v1_tiktokseller`… KHÔNG có `sessionid` trần.
 *
 * Bản đầu của hàm này khớp tên chính xác nên chặn oan cookie hợp lệ (2026-08-04).
 */
const LOGIN_COOKIE_PATTERN =
  /^(sessionid|sid_tt|sid_guard|sid_ucp_v1|ssid_ucp_v1)(_|$)/i;

/**
 * Cookie có token đăng nhập thật hay không.
 *
 * `msToken` KHÔNG tính: nó chỉ là token chống bot, có mặt cả khi chưa login.
 *
 * ⚠️ Đây là HEURISTIC theo tên cookie, KHÔNG phải bằng chứng. TikTok đổi cách
 * đặt tên là hàm này sai ngay. Vì vậy nơi gọi chỉ dùng nó để CẢNH BÁO, tuyệt đối
 * không dùng để chặn — bằng chứng thật là page có bị redirect khỏi
 * affiliate.tiktok.com hay không (xem openContextSession).
 */
export function hasLoginSession(cookies: CookieEntry[]): boolean {
  return cookies.some(
    (c) => LOGIN_COOKIE_PATTERN.test(c.name) && c.value.trim() !== '',
  );
}

/** Ngược của parseCookieString: CookieEntry[] → "k=v; k=v". */
export function serializeCookies(cookies: CookieEntry[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/**
 * Gộp cookie MỚI (browser trả về) đè lên cookie CŨ, giữ lại cookie cũ mà
 * browser không nhắc tới.
 *
 * Vì sao phải merge chứ không thay thẳng: `context.cookies()` chỉ trả cookie
 * thuộc các domain page đã chạm tới trong phiên. Cookie hợp lệ của domain khác
 * (hoặc TikTok không gửi lại lượt này) sẽ biến mất nếu ghi đè toàn bộ — mất
 * đúng những cookie ta đang cần giữ.
 *
 * Chỉ nhận giá trị mới khác rỗng: cookie bị xoá thường về "" và ta không muốn
 * biến một cookie đang tốt thành rỗng.
 */
export function mergeCookieString(
  oldRaw: string,
  fresh: CookieEntry[],
): { merged: string; changed: string[] } {
  const map = new Map<string, string>();
  for (const c of parseCookieString(oldRaw)) map.set(c.name, c.value);

  const changed: string[] = [];
  for (const c of fresh) {
    const v = (c.value ?? '').trim();
    if (v === '') continue;
    if (map.get(c.name) !== c.value) changed.push(c.name);
    map.set(c.name, c.value);
  }

  const merged = [...map.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
  return { merged, changed };
}

/**
 * Thông báo hướng dẫn lấy lại cookie đúng cách. Tách riêng để backend, log và
 * UI dùng chung một câu chữ.
 */
export const MISSING_LOGIN_COOKIE_HINT =
  'Cookie thiếu token đăng nhập (sessionid/sid_tt) — các cookie này là httpOnly nên ' +
  'copy bằng document.cookie trong Console sẽ KHÔNG có. Lấy lại: DevTools → tab Network → ' +
  'chọn 1 request tới affiliate.tiktok.com → Headers → Request Headers → copy toàn bộ giá trị "cookie:".';
