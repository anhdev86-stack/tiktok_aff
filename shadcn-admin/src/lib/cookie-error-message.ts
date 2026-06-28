/**
 * Map raw backend error message (từ `checkCookie` / crawler `lastError`) sang
 * thông báo tiếng Việt thân thiện cho user.
 *
 * Backend trả raw để dev debug; FE display friendly để user biết phải làm gì.
 */
export function friendlyCookieError(raw: string | null | undefined): string {
  if (!raw) return 'Cookie đã chết.'

  const s = raw.toLowerCase()

  // Page redirect tới /login → SDK byted_acrawler không tồn tại trên trang
  // login → frontierSign throw. Đây là dạng cookie chết phổ biến nhất.
  if (
    s.includes('frontiersign') ||
    s.includes('byted_acrawler') ||
    s.includes('sdk wrapper aborted')
  ) {
    return 'Cookie hết hạn — TikTok đã đăng xuất. Hãy cập nhật cookie mới.'
  }

  // TikTok marketplace error codes (xem tiktok-client.service.ts:checkCookie)
  if (s.includes('code_10000')) {
    return 'Cookie chết: msToken hết hạn hoặc shop không match cookie account.'
  }
  if (s.includes('code_98001004')) {
    return 'Shop ID không khớp cookie hoặc account chưa có quyền Affiliate Creator.'
  }
  if (s.includes('code_100000')) {
    return 'Sign insufficient — SDK signing lỗi. Thử lại hoặc cập nhật cookie.'
  }

  // HTTP-level auth fail
  if (s.includes('http_401') || s.includes('http_403')) {
    return 'Cookie hết hạn (HTTP 401/403). Hãy cập nhật cookie mới.'
  }

  // Response không parse được — thường do TikTok trả HTML login page
  if (s.includes('invalid_json')) {
    return 'TikTok trả response không hợp lệ — có thể cookie đã hết hạn.'
  }

  // Pool đầy (rất hiếm vì default 1000 context) — giữ raw để admin biết tăng env
  if (s.includes('browser pool đầy')) return raw

  // HTTP errors khác hoặc unknown — fallback raw nhưng cắt ngắn nếu quá dài
  return raw.length > 160 ? `${raw.slice(0, 160)}…` : raw
}
