import { Controller, Get, Query } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';

@Controller('audit-logs')
export class AuditLogController {
  constructor(private readonly svc: AuditLogService) {}

  @Get()
  list(
    @Query('page') page?: string,
    @Query('size') size?: string,
    @Query('action') action?: string,
    @Query('actor') actor?: string,
  ) {
    return this.svc.list({ page, size, action, actor });
  }
}
