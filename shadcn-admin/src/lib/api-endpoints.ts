import { del, get, patch, post, put } from './api-client'
import type {
  AppSettings,
  AuditLogsResult,
  CheckCookieResult,
  CreateCrawlerGroupInput,
  CreateServiceAccountInput,
  CreateTiktokAccountInput,
  CrawlerGroup,
  CrawlerGroupStatus,
  LoginResponse,
  MarketplaceOptions,
  MeResponse,
  SaHealthResult,
  ServiceAccount,
  ServiceAccountEmail,
  TiktokAccount,
  UpdateAppSettingsInput,
  UpdateCrawlerGroupInput,
  UpdateServiceAccountInput,
  UpdateTiktokAccountInput,
} from './api-types'

// --- Auth ---
export const authApi = {
  login: (username: string, password: string) =>
    post<LoginResponse>('/auth/login', { username, password }),
  me: () => get<MeResponse>('/auth/me'),
}

// --- Service Accounts ---
export const serviceAccountApi = {
  list: () => get<ServiceAccount[]>('/service-accounts'),
  emails: () => get<ServiceAccountEmail[]>('/service-accounts/emails'),
  create: (input: CreateServiceAccountInput) =>
    post<ServiceAccount>('/service-accounts', input),
  update: (id: string, input: UpdateServiceAccountInput) =>
    patch<ServiceAccount>(`/service-accounts/${id}`, input),
  remove: (id: string) =>
    del<{ deleted: true }>(`/service-accounts/${id}`),
  /** Check toàn bộ SA (credential sống?, + quyền sheet nếu có spreadsheetId). */
  health: (spreadsheetId?: string) =>
    get<SaHealthResult[]>(
      `/service-accounts/health${spreadsheetId ? `?spreadsheetId=${encodeURIComponent(spreadsheetId)}` : ''}`
    ),
  /** Check 1 SA theo id. */
  healthOne: (id: string, spreadsheetId?: string) =>
    post<SaHealthResult[]>(
      `/service-accounts/${id}/health${spreadsheetId ? `?spreadsheetId=${encodeURIComponent(spreadsheetId)}` : ''}`
    ),
}

// --- TikTok Accounts ---
export const tiktokAccountApi = {
  list: () => get<TiktokAccount[]>('/tiktok-accounts'),
  get: (id: string) => get<TiktokAccount>(`/tiktok-accounts/${id}`),
  create: (input: CreateTiktokAccountInput) =>
    post<TiktokAccount>('/tiktok-accounts', input),
  update: (id: string, input: UpdateTiktokAccountInput) =>
    patch<TiktokAccount>(`/tiktok-accounts/${id}`, input),
  remove: (id: string) =>
    del<{ deleted: true }>(`/tiktok-accounts/${id}`),
  checkCookie: (id: string) =>
    post<CheckCookieResult>(`/tiktok-accounts/${id}/check-cookie`),
  /**
   * Lấy options TikTok marketplace (danh mục) để build category filter UI.
   * Backend tự chọn account còn sống + failover — không cần truyền account id.
   */
  marketplaceOptions: (region?: string) =>
    get<MarketplaceOptions>(
      `/tiktok-accounts/marketplace-options${region ? `?region=${encodeURIComponent(region)}` : ''}`,
    ),
}

// --- App Settings ---
export const appSettingsApi = {
  get: () => get<AppSettings>('/app-settings'),
  update: (input: UpdateAppSettingsInput) =>
    put<AppSettings>('/app-settings', input),
  testSheetAccess: (spreadsheetId: string) =>
    post<{ allOk: boolean }>('/app-settings/test-sheet-access', {
      spreadsheetId,
    }),
}

// --- Crawler ---
export const crawlerApi = {
  /** GET /crawler/status — returns live status for all groups. */
  allStatus: () => get<CrawlerGroupStatus[]>('/crawler/status'),
  groupStatus: (id: string) => get<CrawlerGroupStatus>(`/crawler/groups/${id}/status`),
  startGroup: (id: string) => post<void>(`/crawler/groups/${id}/start`),
  stopGroup: (id: string) => post<void>(`/crawler/groups/${id}/stop`),
}

// --- Crawler Groups ---
export const crawlerGroupApi = {
  list: () => get<CrawlerGroup[]>('/crawler-groups'),
  get: (id: string) => get<CrawlerGroup>(`/crawler-groups/${id}`),
  create: (data: CreateCrawlerGroupInput) =>
    post<CrawlerGroup>('/crawler-groups', data),
  update: (id: string, data: UpdateCrawlerGroupInput) =>
    patch<CrawlerGroup>(`/crawler-groups/${id}`, data),
  remove: (id: string) => del<{ deleted: true }>(`/crawler-groups/${id}`),
}

// --- Audit Logs ---
export interface ListAuditParams {
  page?: number
  size?: number
  action?: string
  actor?: string
}

export const auditLogApi = {
  list: (params?: ListAuditParams) =>
    get<AuditLogsResult>('/audit-logs', params),
}
