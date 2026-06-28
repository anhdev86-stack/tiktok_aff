import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type FilterQuery, Model } from 'mongoose';
import { AuditLog, type AuditLogDocument } from './schemas/audit-log.schema';
import {
  type Paginated,
  paginate,
  parsePagination,
  type PaginationInput,
} from '../../common/pagination';

export interface AuditEntry {
  actor?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  success?: boolean;
  ip?: string;
  userAgent?: string;
  meta?: Record<string, unknown>;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @InjectModel(AuditLog.name)
    private readonly model: Model<AuditLogDocument>,
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.model.create({
        actor: entry.actor,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        success: entry.success ?? true,
        ip: entry.ip,
        userAgent: entry.userAgent,
        meta: entry.meta,
      });
    } catch (err) {
      this.logger.error(
        `audit write failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async list(
    opts: PaginationInput & {
      action?: string;
      actor?: string;
    } = {},
  ): Promise<Paginated<AuditLogDocument>> {
    const { page, size } = parsePagination(opts, { size: 50 });
    const filter: FilterQuery<AuditLogDocument> = {};
    if (opts.action) filter.action = opts.action;
    if (opts.actor) filter.actor = opts.actor;
    return paginate(this.model, { filter, page, size });
  }
}
