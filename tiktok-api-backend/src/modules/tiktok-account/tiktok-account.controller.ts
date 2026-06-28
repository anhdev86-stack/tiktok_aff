import {
  Body,
  Controller,
  ConflictException,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { type FastifyRequest } from 'fastify';
import {
  TiktokAccountService,
  COOKIE_EXPIRED_CODE,
} from './tiktok-account.service';
import { CreateTiktokAccountDto } from './dto/create-tiktok-account.dto';
import { UpdateTiktokAccountDto } from './dto/update-tiktok-account.dto';
import { AuditLogService } from '../audit-log/audit-log.service';
import {
  TiktokClientService,
  TiktokSearchAuthError,
  TiktokSessionDeadError,
} from '../tiktok-client/tiktok-client.service';

interface AuthedRequest extends FastifyRequest {
  user?: { username?: string };
}

@Controller('tiktok-accounts')
export class TiktokAccountController {
  constructor(
    private readonly svc: TiktokAccountService,
    private readonly audit: AuditLogService,
    private readonly tiktok: TiktokClientService,
  ) {}

  @Post()
  async create(@Body() dto: CreateTiktokAccountDto, @Req() req: AuthedRequest) {
    const r = await this.svc.create(dto);
    void this.audit.record({
      actor: req.user?.username,
      action: 'tiktok-account.create',
      targetType: 'tiktok-account',
      targetId: String(r._id),
      ip: req.ip,
      meta: { name: r.name, shopId: r.shopId },
    });
    return r;
  }

  @Get()
  findAll(@Query('groupId') groupId?: string) {
    return this.svc.findAll(groupId ? { groupId } : undefined);
  }

  /**
   * Danh mục marketplace (global theo shop-region) — KHÔNG gắn account cụ thể.
   * Backend tự chọn account còn sống + failover. Khai báo TRƯỚC route `:id` để
   * Fastify match static path thay vì coi "marketplace-options" là id.
   */
  @Get('marketplace-options')
  marketplaceOptionsAny(@Query('region') region?: string) {
    return this.svc.marketplaceOptionsAnyAlive(region);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.svc.findById(id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTiktokAccountDto,
    @Req() req: AuthedRequest,
  ) {
    const r = await this.svc.update(id, dto);
    void this.audit.record({
      actor: req.user?.username,
      action: 'tiktok-account.update',
      targetType: 'tiktok-account',
      targetId: id,
      ip: req.ip,
      meta: { fields: Object.keys(dto) },
    });
    return r;
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: AuthedRequest) {
    const r = await this.svc.remove(id);
    void this.audit.record({
      actor: req.user?.username,
      action: 'tiktok-account.delete',
      targetType: 'tiktok-account',
      targetId: id,
      ip: req.ip,
    });
    return r;
  }

  /**
   * Manual probe cookie. FE bấm "Check cookie" trong row hoặc retry sau khi
   * dán cookie mới.
   */
  @Post(':id/check-cookie')
  async checkCookie(@Param('id') id: string, @Req() req: AuthedRequest) {
    const r = await this.svc.checkCookie(id);
    void this.audit.record({
      actor: req.user?.username,
      action: 'tiktok-account.check-cookie',
      targetType: 'tiktok-account',
      targetId: id,
      ip: req.ip,
      success: r.cookieAlive === true,
      meta: { message: r.cookieCheckMessage },
    });
    return {
      alive: r.cookieAlive,
      checkedAt: r.cookieCheckedAt,
      message: r.cookieCheckMessage,
    };
  }

  /**
   * Lấy options TikTok marketplace để build category filter UI (từng chạy qua
   * /creators/marketplace/options — đã move sang đây sau khi creator module xóa).
   */
  @Get(':id/marketplace-options')
  async marketplaceOptions(@Param('id') id: string) {
    const account = await this.svc.assertCookieAlive(id);
    try {
      return await this.tiktok.getMarketplaceOptions({
        cookie: account.cookie,
        shopId: account.shopId,
        shopRegion: account.shopRegion,
      });
    } catch (err) {
      if (
        err instanceof TiktokSearchAuthError ||
        err instanceof TiktokSessionDeadError
      ) {
        const reason =
          err instanceof TiktokSearchAuthError
            ? `option_code_${err.code}`
            : 'session_dead';
        await this.svc.markCookieDead(
          String(account._id),
          `${reason}: ${err.message.slice(0, 120)}`,
        );
        throw new ConflictException({
          code: COOKIE_EXPIRED_CODE,
          message:
            'Cookie hết hạn hoặc shopId/quyền affiliate sai — kiểm tra lại tài khoản.',
          accountId: String(account._id),
          accountName: account.name,
          cookieCheckMessage: reason,
        });
      }
      throw err;
    }
  }
}
