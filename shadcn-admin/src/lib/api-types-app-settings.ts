/**
 * Type contracts for AppSettings + CrawlerStatus — mirrors the BE schemas in
 * tiktok-api-backend/src/modules/app-settings/ and crawler/.
 */

export interface AppSettings {
  _id: string
  key: 'singleton'
  /** Global Google Sheet ID (empty = not configured). */
  spreadsheetId: string
  sheetOverview: string
  sheetTopVideos: string
  sheetTrend: string
  crawlerEnabled: boolean
  /** [[parentId, childId], ...] — empty = all categories. */
  categoryList: Array<[string, string]>
  delayBetweenAccountsMs: number
  delayBetweenLoopsMs: number
  /** Delay giữa các page khi 1 account quét nhiều trang creators (ms). */
  delayBetweenPagesMs: number
  /** Số page 1 shop crawl mỗi lượt trước khi nhường shop kế (burst size). */
  pagesPerRun: number
  /** Live status written by CrawlerService. */
  crawlerStatus: 'idle' | 'running' | 'sleeping' | 'stopping'
  lastLoopStartedAt: string | null
  lastLoopFinishedAt: string | null
  currentAccountId: string | null
  loopCount: number
  lastError: string
  createdAt?: string
  updatedAt?: string
}

/** Writable config fields only — live status fields excluded. */
export type UpdateAppSettingsInput = Partial<
  Pick<
    AppSettings,
    | 'spreadsheetId'
    | 'sheetOverview'
    | 'sheetTopVideos'
    | 'sheetTrend'
    | 'crawlerEnabled'
    | 'categoryList'
    | 'delayBetweenAccountsMs'
    | 'delayBetweenLoopsMs'
    | 'delayBetweenPagesMs'
    | 'pagesPerRun'
  >
>

/** Shape returned by GET /crawler/status. */
export interface CrawlerStatus {
  crawlerEnabled: boolean
  crawlerStatus: AppSettings['crawlerStatus']
  currentAccountId: string | null
  lastLoopStartedAt: string | null
  lastLoopFinishedAt: string | null
  loopCount: number
  lastError: string
  /** In-memory flag — true when loop is active. */
  running: boolean
}
