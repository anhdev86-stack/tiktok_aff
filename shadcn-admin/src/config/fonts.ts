/**
 * Danh sách font dashboard.
 *  - inter / manrope: load từ Google Fonts (xem `<link>` trong index.html).
 *  - system: dùng font mặc định OS.
 *
 * Muốn thêm font:
 *   1) Thêm tên ở array dưới đây.
 *   2) Thêm `<link>` Google Fonts (hoặc self-hosted) trong index.html.
 *   3) Khai báo `--font-<name>` trong styles/theme.css `@theme inline`.
 *   4) Nếu dùng external CDN — bổ sung domain vào CSP `font-src` + `style-src` (xem nginx.conf).
 */
export const fonts = ['inter', 'manrope', 'system'] as const
