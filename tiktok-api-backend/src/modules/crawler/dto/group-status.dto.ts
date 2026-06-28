/**
 * GroupStatusDto — response shape for GET /crawler/status and GET /crawler/groups/:id/status.
 * Combines all CrawlerGroup fields with in-memory runtime flag `running`.
 */
export interface GroupStatusDto {
  _id: string;
  name: string;
  spreadsheetId: string;
  sheetOverview: string;
  sheetTopVideos: string;
  sheetTrend: string;
  categoryList: Array<[string, string]>;
  enabled: boolean;
  status: 'idle' | 'running' | 'sleeping' | 'stopping';
  /** Mongoose ObjectId string or null when idle. */
  currentAccountId: string | null;
  lastLoopStartedAt: Date | null;
  lastLoopFinishedAt: Date | null;
  loopCount: number;
  lastError: string;
  /** In-memory flag — true while GroupWorker goroutine is alive. */
  running: boolean;
}
