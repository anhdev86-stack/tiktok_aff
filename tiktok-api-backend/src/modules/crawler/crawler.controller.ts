/**
 * CrawlerController — per-group crawler lifecycle endpoints.
 *
 * GET  /crawler/status                   — all groups status (dashboard poll)
 * GET  /crawler/groups/:groupId/status   — single group status
 * POST /crawler/groups/:groupId/start    — start group worker (idempotent)
 * POST /crawler/groups/:groupId/stop     — stop group worker (idempotent)
 */
import { Controller, Get, Param, Post, Req } from '@nestjs/common';
import { type FastifyRequest } from 'fastify';
import { CrawlerOrchestratorService } from './crawler-orchestrator.service';
import { AuditLogService } from '../audit-log/audit-log.service';

interface AuthedRequest extends FastifyRequest {
  user?: { username?: string };
}

@Controller('crawler')
export class CrawlerController {
  constructor(
    private readonly orchestrator: CrawlerOrchestratorService,
    private readonly audit: AuditLogService,
  ) {}

  /** GET /crawler/status — poll all groups every 2s from FE Crawler Monitor. */
  @Get('status')
  getAllStatus() {
    return this.orchestrator.getAllStatus();
  }

  /** GET /crawler/groups/:groupId/status — single group status. */
  @Get('groups/:groupId/status')
  getGroupStatus(@Param('groupId') groupId: string) {
    return this.orchestrator.getGroupStatus(groupId);
  }

  /**
   * GET /crawler/groups/:groupId/diagnose
   * Trả nguyên nhân + suggestion khi worker không crawl (group disabled / 0
   * account / cookie dead / spreadsheet trống). Dùng cho UI debug nhanh,
   * không cần xem log backend hay query mongo.
   */
  @Get('groups/:groupId/diagnose')
  diagnose(@Param('groupId') groupId: string) {
    return this.orchestrator.diagnoseGroup(groupId);
  }

  /** POST /crawler/groups/:groupId/start — enable and start group worker. */
  @Post('groups/:groupId/start')
  async startGroup(
    @Param('groupId') groupId: string,
    @Req() req: AuthedRequest,
  ) {
    const result = await this.orchestrator.startGroup(groupId);
    void this.audit.record({
      actor: req.user?.username,
      action: 'crawler.group.start',
      targetType: 'crawler_group',
      targetId: groupId,
      success: true,
      ip: req.ip,
    });
    return result;
  }

  /** POST /crawler/groups/:groupId/stop — disable and stop group worker. */
  @Post('groups/:groupId/stop')
  async stopGroup(
    @Param('groupId') groupId: string,
    @Req() req: AuthedRequest,
  ) {
    const result = await this.orchestrator.stopGroup(groupId);
    void this.audit.record({
      actor: req.user?.username,
      action: 'crawler.group.stop',
      targetType: 'crawler_group',
      targetId: groupId,
      success: true,
      ip: req.ip,
    });
    return result;
  }
}
