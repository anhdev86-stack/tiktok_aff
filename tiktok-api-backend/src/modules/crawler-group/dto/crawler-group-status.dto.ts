/** Shape returned by GET /crawler-groups/:id/status */
export interface CrawlerGroupStatusDto {
  groupId: string;
  name: string;
  enabled: boolean;
  status: 'idle' | 'running' | 'sleeping' | 'stopping';
  currentAccountId: string | null;
  lastLoopStartedAt: Date | null;
  lastLoopFinishedAt: Date | null;
  loopCount: number;
  lastError: string;
}
