/**
 * flatten.util — biến response TikTok (lồng nhau, mỗi field bọc {value}) thành
 * hàng phẳng để ghi Google Sheets.
 *
 * Đặc thù API: field có thể là placeholder KHÔNG có quyền xem — dạng
 * `{is_authorized: false}` mà không có `value`. Phải phân biệt với "có quyền
 * nhưng giá trị null", nếu không sẽ ghi đè dữ liệu tốt bằng ô rỗng (xem
 * `isNoAuthPlaceholder` + `hasRealValue`).
 *
 * KHÔI PHỤC: dịch ngược từ `dist/` image production
 * `hecatechvn/tiktok-api-backend:latest` (build 2026-06-28).
 */

/** Kiểu cột điều khiển alignment + numberFormat + width bên google-sheets.service. */
export type ColumnType =
  | 'text'
  | 'longText'
  | 'url'
  | 'integer'
  | 'number'
  | 'currency'
  | 'percent'
  | 'date';

export interface ColumnSpec {
  type: ColumnType;
}

export const OVERVIEW_HEADER = [
  'Shop',
  'OEC ID',
  'Username',
  'Nickname',
  'Profile URL',
  'Followers',
  'Bio',
  'Danh mục',
  'Ngành chính',
  'Đã cộng tác',
  'Điểm hoàn thành 90d',
  'GMV (trung vị)',
  'Số món bán ra',
  'Video GMV',
  'LIVE GMV',
] as const;

export const TOP_VIDEO_HEADER = [
  'Shop',
  'Creator OEC ID',
  'Video ID',
  'Ngày đăng',
  'SP chính',
  'SP ID',
] as const;

export const TREND_HEADER = [
  'Shop',
  'Creator OEC ID',
  'Chỉ số',
  'Ngày',
  'Giá trị',
] as const;

export const OVERVIEW_COL_SPECS: Record<string, ColumnSpec> = {
  Shop: { type: 'text' },
  'OEC ID': { type: 'text' },
  Username: { type: 'text' },
  Nickname: { type: 'text' },
  'Profile URL': { type: 'url' },
  Followers: { type: 'integer' },
  Bio: { type: 'longText' },
  'Danh mục': { type: 'longText' },
  'Ngành chính': { type: 'text' },
  'Đã cộng tác': { type: 'integer' },
  'Điểm hoàn thành 90d': { type: 'number' },
  'GMV (trung vị)': { type: 'currency' },
  'Số món bán ra': { type: 'integer' },
  'Video GMV': { type: 'currency' },
  'LIVE GMV': { type: 'currency' },
};

export const TOP_VIDEO_COL_SPECS: Record<string, ColumnSpec> = {
  Shop: { type: 'text' },
  'Creator OEC ID': { type: 'text' },
  'Video ID': { type: 'text' },
  'Ngày đăng': { type: 'date' },
  'SP chính': { type: 'longText' },
  'SP ID': { type: 'text' },
};

export const TREND_COL_SPECS: Record<string, ColumnSpec> = {
  Shop: { type: 'text' },
  'Creator OEC ID': { type: 'text' },
  'Chỉ số': { type: 'text' },
  Ngày: { type: 'date' },
  'Giá trị': { type: 'text' },
};

export interface OverviewResult {
  row: Record<string, unknown>;
  /** Header thiếu dữ liệu — dùng để log chẩn đoán, không chặn ghi sheet. */
  missing: string[];
}

/** Seed lấy từ tầng trên (search card) để bù field mà /profile không trả. */
export interface CreatorSeed {
  oecuid: string;
  handle?: string | null;
  nickname?: string | null;
  follower_cnt?: unknown;
}

type ProfileByType = Record<number, unknown>;

/** `{is_authorized: …}` mà KHÔNG có `value` = không có quyền xem, không phải null thật. */
function isNoAuthPlaceholder(field: unknown): boolean {
  if (field == null || typeof field !== 'object') return false;
  const obj = field as Record<string, unknown>;
  return 'is_authorized' in obj && !('value' in obj);
}

function unwrap(field: unknown): unknown {
  if (field == null) return null;
  if (typeof field !== 'object') return field;
  if (isNoAuthPlaceholder(field)) return null;
  const obj = field as Record<string, unknown>;
  if ('value' in obj) return obj.value;
  return field;
}

function hasRealValue(field: unknown): boolean {
  if (field == null) return false;
  if (typeof field !== 'object') return true;
  if (isNoAuthPlaceholder(field)) return false;
  const obj = field as Record<string, unknown>;
  if ('value' in obj) return obj.value !== null && obj.value !== undefined;
  if (Array.isArray(field)) return field.length > 0;
  return Object.keys(obj).length > 0;
}

/** Unix giây hoặc mili → dd/mm/yyyy. Chuỗi rỗng nếu không parse được. */
function fmtDate(ts: number | string | null): string {
  if (ts == null || ts === '') return '';
  const num = typeof ts === 'string' ? Number(ts) : ts;
  if (!Number.isFinite(num) || num <= 0) return '';
  const ms = num > 1e12 ? num : num * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function pickMoneyValue(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'object') {
    const o = v as { value?: unknown };
    if (o.value == null || o.value === '') return null;
    const n = Number(o.value);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toNumOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickFirstRaw(
  merged: Record<string, unknown>,
  candidates: string[],
): unknown {
  for (const k of candidates) {
    if (k in merged) {
      const v = unwrap(merged[k]);
      if (v != null && v !== '') return v;
    }
  }
  return null;
}

function joinCategories(v: unknown): string {
  if (Array.isArray(v)) {
    return v
      .map((x) => {
        if (x == null) return null;
        if (typeof x === 'string') return x;
        const o = x as { name?: string; value?: string };
        return o.name ?? o.value ?? null;
      })
      .filter((s): s is string => !!s)
      .join(', ');
  }
  return String(v);
}

interface OverviewField {
  header: string;
  candidates: string[];
  transform?: (v: unknown) => unknown;
  /** Không tính vào `missing` — field này vốn có thể trống hợp lệ. */
  skipMissing?: boolean;
}

const OVERVIEW_FIELDS: OverviewField[] = [
  { header: 'OEC ID', candidates: ['oec_id'], skipMissing: true },
  { header: 'Username', candidates: ['handle'], skipMissing: true },
  { header: 'Nickname', candidates: ['nickname'], skipMissing: true },
  { header: 'Profile URL', candidates: ['profile_url'], skipMissing: true },
  { header: 'Followers', candidates: ['followers', 'follower_cnt'] },
  { header: 'Bio', candidates: ['bio'] },
  { header: 'Danh mục', candidates: ['category'], transform: joinCategories },
  {
    header: 'Ngành chính',
    candidates: ['industry_groups'],
    transform: (v) => {
      if (!Array.isArray(v) || v.length === 0) return '';
      const top = v[0] as { name?: string } | undefined;
      return top?.name ?? '';
    },
  },
  {
    header: 'Đã cộng tác',
    candidates: ['collaborated_brands_num'],
    transform: toNumOrNull,
  },
  {
    header: 'Điểm hoàn thành 90d',
    candidates: ['creator_fulfillment_score_90d'],
    transform: toNumOrNull,
  },
  {
    header: 'GMV (trung vị)',
    candidates: ['med_gmv_revenue'],
    transform: pickMoneyValue,
  },
  {
    header: 'Số món bán ra',
    candidates: ['units_sold'],
    transform: toNumOrNull,
  },
  { header: 'Video GMV', candidates: ['video_gmv'], transform: pickMoneyValue },
  { header: 'LIVE GMV', candidates: ['live_gmv'], transform: pickMoneyValue },
];

/** Dựng hàng Tổng quan từ `merged` (đã gộp mọi nguồn) + seed. */
function buildOverviewRow(seedMerged: Record<string, unknown>): OverviewResult {
  const row: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const f of OVERVIEW_FIELDS) {
    const raw = pickFirstRaw(seedMerged, f.candidates);
    if (raw == null) {
      row[f.header] = '';
      if (!f.skipMissing) missing.push(f.header);
    } else {
      row[f.header] = f.transform ? f.transform(raw) : raw;
    }
  }
  return { row, missing };
}

/**
 * Gộp creator_profile của profile_type 1/2/3 rồi dựng hàng Tổng quan.
 *
 * Cùng 1 field có thể xuất hiện ở nhiều type, chỗ có quyền chỗ không → ưu tiên
 * nguồn ĐẦU TIÊN có giá trị thật; không nguồn nào có thì giữ nguyên placeholder
 * để `missing` phản ánh đúng.
 */
export function flattenOverview(
  creator: CreatorSeed,
  profileByType: ProfileByType,
): OverviewResult {
  const sources = [1, 2, 3].map(
    (t) =>
      ((profileByType[t] as { creator_profile?: Record<string, unknown> })
        ?.creator_profile ?? {}) as Record<string, unknown>,
  );

  const allKeys = new Set<string>();
  sources.forEach((s) => Object.keys(s).forEach((k) => allKeys.add(k)));

  const merged: Record<string, unknown> = {};
  for (const k of allKeys) {
    let chosen: unknown;
    for (const s of sources) {
      if (hasRealValue(s[k])) {
        chosen = s[k];
        break;
      }
    }
    if (chosen === undefined) {
      chosen = sources.find((s) => k in s)?.[k];
    }
    merged[k] = chosen;
  }

  const handle = creator.handle ?? unwrap(merged.handle);
  const seedMerged: Record<string, unknown> = {
    ...merged,
    oec_id: creator.oecuid,
    handle,
    nickname: creator.nickname ?? unwrap(merged.nickname) ?? null,
    profile_url: handle ? `https://www.tiktok.com/@${String(handle)}` : null,
    followers:
      unwrap(creator.follower_cnt) ?? unwrap(merged.follower_cnt) ?? null,
  };

  return buildOverviewRow(seedMerged);
}

/** Thẻ creator từ API find — đủ field để dựng hàng khi TẮT enrich /profile. */
export interface CreatorCard {
  oec_id: string;
  handle?: string | null;
  nickname?: string | null;
  follower_cnt?: number | null;
  categories?: string[];
  gmvMedian?: { value?: number | null } | null;
  unitsSold?: number | null;
}

/**
 * Dựng hàng Tổng quan THẲNG từ thẻ find, không gọi /profile.
 *
 * Dùng khi CRAWLER_ENRICH_PROFILE=false: nhanh hơn nhiều (bỏ 1 request/creator)
 * nhưng 5 cột chỉ có ở /profile sẽ trống: Bio, Ngành chính, Đã cộng tác,
 * Điểm hoàn thành 90d, Video GMV, LIVE GMV.
 */
export function flattenOverviewFromCard(card: CreatorCard): OverviewResult {
  const handle = card.handle ?? null;
  const seedMerged: Record<string, unknown> = {
    oec_id: card.oec_id,
    handle,
    nickname: card.nickname ?? null,
    profile_url: handle ? `https://www.tiktok.com/@${handle}` : null,
    followers: card.follower_cnt ?? null,
    category: card.categories ?? [],
    med_gmv_revenue: card.gmvMedian?.value ?? null,
    units_sold: card.unitsSold ?? null,
  };
  return buildOverviewRow(seedMerged);
}

export function flattenTopVideos(
  creator: CreatorSeed,
  profileByType: ProfileByType,
): Array<Record<string, unknown>> {
  const p5 = (profileByType[5] as { creator_profile?: Record<string, unknown> })
    ?.creator_profile;
  const ec = unwrap(p5?.ec_top_video_data) ?? [];
  return (Array.isArray(ec) ? ec : []).map((vRaw) => {
    const v = vRaw as {
      item_id?: string;
      release_date?: number | string;
      video_products?: Array<{ name?: string; product_id?: string }>;
    };
    const products = Array.isArray(v.video_products) ? v.video_products : [];
    const main = products[0] ?? null;
    return {
      'Creator OEC ID': creator.oecuid,
      'Video ID': v.item_id ?? null,
      'Ngày đăng': fmtDate(v.release_date ?? null),
      'SP chính': main?.name ?? null,
      'SP ID': main?.product_id ?? null,
    };
  });
}

export function flattenTrend(
  creator: CreatorSeed,
  profileByType: ProfileByType,
): Array<Record<string, unknown>> {
  const p4 =
    (profileByType[4] as { creator_profile_trend_data?: unknown })
      ?.creator_profile_trend_data ?? [];
  const blocks = Array.isArray(p4) ? p4 : Object.values(p4 as object);

  const keepDays = Number(process.env.TREND_KEEP_DAYS) || 30;
  const cutoffTs = keepDays > 0 ? Date.now() / 1000 - keepDays * 86400 : 0;

  // Cùng (creator, chỉ số, ngày) có thể lặp ở nhiều block → giữ bản cuối.
  const dedup = new Map<string, Record<string, unknown>>();
  for (const block of blocks) {
    const b = block as { stats?: unknown };
    const stats = Array.isArray(b?.stats) ? b.stats : [];
    for (const point of stats) {
      const p = point as {
        start_timestamp?: number;
        profile?: Record<string, unknown>;
      };
      const ts = p?.start_timestamp;
      if (cutoffTs > 0 && ts != null && ts < cutoffTs) continue;
      const date = fmtDate(ts ?? null);
      const profile = p?.profile ?? {};
      for (const [metric, wrapped] of Object.entries(profile)) {
        const inner = unwrap(wrapped);
        let value: unknown = inner;
        if (inner && typeof inner === 'object') {
          const vo = inner as { format?: unknown; value?: unknown };
          if (vo.format != null && vo.format !== '') value = vo.format;
          else if (vo.value != null) value = vo.value;
        }
        const cleanMetric = metric.replace(/^trend_/, '');
        const key = `${creator.oecuid}||${cleanMetric}||${date}`;
        dedup.set(key, {
          'Creator OEC ID': creator.oecuid,
          'Chỉ số': cleanMetric,
          Ngày: date,
          'Giá trị': value,
        });
      }
    }
  }
  return [...dedup.values()];
}
