import { Body, Controller, Get, Post, Put, Req } from '@nestjs/common';
import { type FastifyRequest } from 'fastify';
import { AppSettingsService } from './app-settings.service';
import {
  UpdateAppSettingsDto,
  TestSheetAccessDto,
} from './dto/update-app-settings.dto';
import { AuditLogService } from '../audit-log/audit-log.service';

interface AuthedRequest extends FastifyRequest {
  user?: { username?: string };
}

/**
 * REST endpoints for global app settings (singleton config).
 * All routes protected by global JwtAuthGuard (set in app.module.ts).
 */
@Controller('app-settings')
export class AppSettingsController {
  constructor(
    private readonly svc: AppSettingsService,
    private readonly audit: AuditLogService,
  ) {}

  /** GET /app-settings — returns singleton doc, auto-creates with defaults if absent. */
  @Get()
  get() {
    return this.svc.get();
  }

  /** PUT /app-settings — partial update of writable config fields. */
  @Put()
  async update(@Body() dto: UpdateAppSettingsDto, @Req() req: AuthedRequest) {
    const result = await this.svc.update(dto);
    void this.audit.record({
      actor: req.user?.username,
      action: 'app-settings.update',
      targetType: 'app-settings',
      targetId: 'singleton',
      // Log only field names — body may contain large categoryList
      meta: { fields: Object.keys(dto) },
      ip: req.ip,
    });
    return result;
  }

  /**
   * POST /app-settings/test-sheet-access
   * Probe all active SAs against the configured (or provided) spreadsheetId.
   * Returns per-SA access results so UI can show which SAs need to be shared.
   */
  @Post('test-sheet-access')
  testSheetAccess(@Body() dto: TestSheetAccessDto) {
    return this.svc.testSheetAccess(dto.spreadsheetId);
  }
}
