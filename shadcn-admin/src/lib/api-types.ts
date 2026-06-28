/**
 * Type tham chiếu DTO của backend (`tiktok-api-backend`). Dùng làm contract
 * giữa FE và BE — chỉnh ở 2 nơi mỗi khi BE thay đổi schema.
 */

// --- Auth ---
export interface LoginResponse {
  accessToken: string
  user: { username: string; role: string }
}

export interface MeResponse {
  user: { username?: string; role?: string }
}

// --- Service Account ---
export interface ServiceAccount {
  id: string
  label: string
  clientEmail: string
  projectId: string
  active: boolean
  cooldownUntil?: string
  lastUsedAt?: string
  note?: string
  createdAt?: string
}

export interface ServiceAccountEmail {
  id: string
  label: string
  clientEmail: string
  active: boolean
}

export interface SaHealthResult {
  saId: string
  clientEmail: string
  active: boolean
  /** Mint được OAuth token (SA còn sống, key hợp lệ, project chưa xoá). */
  credentialsOk: boolean
  /** Có quyền vào spreadsheet được hỏi. null = không probe (không có sheetId). */
  sheetAccessOk: boolean | null
  error?: string
}

export interface CreateServiceAccountInput {
  label?: string
  sa: Record<string, unknown> | string
  note?: string
  active?: boolean
}

export interface UpdateServiceAccountInput {
  label?: string
  active?: boolean
  note?: string
}

// --- TikTok Account ---
export interface TiktokAccount {
  _id: string
  name: string
  cookie: string
  shopId: string
  shopRegion: string
  active?: boolean
  /** null = chưa probe lần nào; true = sống; false = chết → cần update cookie. */
  cookieAlive?: boolean | null
  cookieCheckedAt?: string | null
  cookieCheckMessage?: string
  /** ID của CrawlerGroup account này thuộc về. */
  groupId?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface CheckCookieResult {
  alive: boolean | null
  checkedAt?: string | null
  message?: string
}

export interface CreateTiktokAccountInput {
  name: string
  cookie: string
  shopId: string
  shopRegion: string
}

export type UpdateTiktokAccountInput = Partial<CreateTiktokAccountInput> & {
  active?: boolean
  /** Assign account vào nhóm (null = bỏ khỏi nhóm). */
  groupId?: string | null
}

export interface TestSheetAccessResult {
  spreadsheetId: string
  allOk: boolean
  results: Array<{
    saId: string
    clientEmail: string
    ok: boolean
    error?: string
  }>
}

// --- Marketplace options (for Search filter UI) ---
export interface MarketplaceCategory {
  id: string
  name: string
  option_children?: Array<{ id: string; name: string }>
}

export interface MarketplaceOptions {
  category: MarketplaceCategory[]
  brand: Array<{ id: string; name: string }>
  priceRange: Array<{ id: string; name: string }>
  language: Array<{ id: string; name: string }>
}

// --- Crawler Groups ---
export interface CrawlerGroup {
  _id: string
  name: string
  spreadsheetId: string
  sheetOverview: string
  sheetTopVideos: string
  sheetTrend: string
  categoryList: Array<[string, string]>
  enabled: boolean
  status: 'idle' | 'running' | 'sleeping' | 'stopping'
  currentAccountId: string | null
  lastLoopStartedAt: string | null
  lastLoopFinishedAt: string | null
  loopCount: number
  lastError: string
  createdAt: string
  updatedAt: string
}

export interface CreateCrawlerGroupInput {
  name: string
  spreadsheetId?: string
  sheetOverview?: string
  sheetTopVideos?: string
  sheetTrend?: string
  categoryList?: Array<[string, string]>
}

export type UpdateCrawlerGroupInput = Partial<CreateCrawlerGroupInput>

export type CrawlerGroupStatus = CrawlerGroup & { running: boolean }

// --- App Settings + Crawler Status (split to keep file under 200 LOC) ---
export type {
  AppSettings,
  CrawlerStatus,
  UpdateAppSettingsInput,
} from './api-types-app-settings'

// --- Audit log ---
export interface AuditLog {
  _id: string
  actor?: string
  action: string
  targetType?: string
  targetId?: string
  success?: boolean
  ip?: string
  userAgent?: string
  meta?: Record<string, unknown>
  createdAt: string
}

export interface AuditLogsResult {
  items: AuditLog[]
  page: number
  size: number
  total: number
}
