import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  TiktokAccount,
  type TiktokAccountDocument,
} from './schemas/tiktok-account.schema';
import {
  CrawlerGroup,
  type CrawlerGroupDocument,
} from '../crawler-group/schemas/crawler-group.schema';
import { type CreateTiktokAccountDto } from './dto/create-tiktok-account.dto';
import { type UpdateTiktokAccountDto } from './dto/update-tiktok-account.dto';
import {
  TiktokClientService,
  TiktokSearchAuthError,
  TiktokSessionDeadError,
  type MarketplaceOptionsResult,
} from '../tiktok-client/tiktok-client.service';

/**
 * Lỗi 409 dành riêng cho cookie hết hạn — FE bắt error code này để mở dialog
 * "Cập nhật cookie". Đừng đổi `code` nếu không sửa cùng `error-codes.ts` ở FE.
 */
export const COOKIE_EXPIRED_CODE = 'COOKIE_EXPIRED';

@Injectable()
export class TiktokAccountService {
  constructor(
    @InjectModel(TiktokAccount.name)
    private readonly model: Model<TiktokAccountDocument>,
    @InjectModel(CrawlerGroup.name)
    private readonly groupModel: Model<CrawlerGroupDocument>,
    private readonly tiktok: TiktokClientService,
  ) {}

  async create(dto: CreateTiktokAccountDto): Promise<TiktokAccountDocument> {
    const exists = await this.model.findOne({ name: dto.name }).exec();
    if (exists) throw new BadRequestException('Account name already exists');

    const payload: Record<string, unknown> = { ...dto };

    if (dto.groupId) {
      // Caller specified a group — phải tồn tại để tránh orphan account.
      // Cast string → ObjectId rõ ràng: mongoose không phải lúc nào cũng
      // auto-cast trong plain-object payload, dẫn tới groupId lưu dạng
      // string + làm `find({ groupId: ObjectId })` không match.
      await this.assertGroupExists(dto.groupId);
      payload.groupId = new Types.ObjectId(dto.groupId);
    } else {
      // Auto-assign to earliest group nếu user không chọn. Tránh limbo "no group".
      const firstGroup = await this.groupModel
        .findOne()
        .sort({ createdAt: 1 })
        .select('_id')
        .exec();
      if (firstGroup) payload.groupId = firstGroup._id;
    }

    return this.model.create(payload);
  }

  /** Throws BadRequest nếu groupId không tồn tại. Dùng cho create/update guard. */
  private async assertGroupExists(groupId: string): Promise<void> {
    if (!Types.ObjectId.isValid(groupId)) {
      throw new BadRequestException(`groupId không hợp lệ: ${groupId}`);
    }
    const exists = await this.groupModel
      .exists({ _id: new Types.ObjectId(groupId) })
      .exec();
    if (!exists) {
      throw new BadRequestException(
        `groupId ${groupId} không tồn tại — chọn 1 nhóm có thật trong UI Crawler Groups`,
      );
    }
  }

  findAll(filter?: { groupId?: string }): Promise<TiktokAccountDocument[]> {
    const query: Record<string, unknown> = {};
    if (filter?.groupId) {
      query['groupId'] = new Types.ObjectId(filter.groupId);
    }
    return this.model.find(query).sort({ createdAt: -1 }).exec();
  }

  /** Fetch all accounts belonging to a specific group. */
  findByGroup(groupId: string): Promise<TiktokAccountDocument[]> {
    return this.model
      .find({ groupId: new Types.ObjectId(groupId) })
      .sort({ createdAt: -1 })
      .exec();
  }

  /** Count accounts in a group — used by CrawlerGroupService to gate deletion. */
  countByGroup(groupId: string): Promise<number> {
    return this.model
      .countDocuments({ groupId: new Types.ObjectId(groupId) })
      .exec();
  }

  async findById(id: string): Promise<TiktokAccountDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Account not found');
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException('Account not found');
    return doc;
  }

  async findByName(name: string): Promise<TiktokAccountDocument | null> {
    return this.model.findOne({ name }).exec();
  }

  async update(
    id: string,
    dto: UpdateTiktokAccountDto,
  ): Promise<TiktokAccountDocument> {
    // Khi user dán cookie mới → reset trạng thái cookie để bắt re-check.
    const patch: Record<string, unknown> = { ...dto };
    if (typeof dto.cookie === 'string') {
      patch.cookieAlive = null;
      patch.cookieCheckedAt = null;
      patch.cookieCheckMessage = undefined;
    }

    // Validate + cast groupId khi user đổi nhóm (null = unassign hợp lệ).
    // Cast string → ObjectId rõ ràng để mongoose lưu đúng BSON type, tránh
    // bug query `find({ groupId: ObjectId })` không match doc có groupId string.
    if (typeof dto.groupId === 'string') {
      await this.assertGroupExists(dto.groupId);
      patch.groupId = new Types.ObjectId(dto.groupId);
    }

    const updated = await this.model
      .findByIdAndUpdate(id, patch, { new: true })
      .exec();
    if (!updated) throw new NotFoundException('Account not found');
    return updated;
  }

  async remove(id: string): Promise<{ deleted: true }> {
    const r = await this.model.findByIdAndDelete(id).exec();
    if (!r) throw new NotFoundException('Account not found');
    return { deleted: true };
  }

  /**
   * Lưu cursor page crawl (resume). updateOne nhẹ — không load doc. Gọi sau mỗi
   * page ghi xong để vòng/lượt sau tiếp tục lấy creator mới thay vì restart 0.
   */
  async setCrawlCursor(id: string, page: number): Promise<void> {
    await this.model
      .updateOne(
        { _id: new Types.ObjectId(id) },
        { $set: { crawlCursorPage: Math.max(0, page) } },
      )
      .exec();
  }

  /**
   * Đánh dấu cookie chết (gọi từ chỗ khác phát hiện auth fail giữa luồng,
   * vd /creators/search bị code != 0). Không gọi lại info_v2 vì đã có bằng
   * chứng từ caller — info_v2 đôi khi nói "alive" trong khi marketplace
   * sign vẫn fail.
   */
  async markCookieDead(
    id: string,
    message: string,
  ): Promise<TiktokAccountDocument> {
    const acc = await this.findById(id);
    acc.cookieAlive = false;
    acc.cookieCheckedAt = new Date();
    acc.cookieCheckMessage = message;
    await acc.save();
    return acc;
  }

  /**
   * Probe cookie với TikTok info_v2, lưu kết quả vào DB. Trả về document
   * đã update (kèm cookieAlive, cookieCheckedAt, cookieCheckMessage).
   */
  async checkCookie(id: string): Promise<TiktokAccountDocument> {
    const acc = await this.findById(id);
    const r = await this.tiktok.checkCookie({
      cookie: acc.cookie,
      shopId: acc.shopId,
      shopRegion: acc.shopRegion,
    });
    acc.cookieAlive = r.alive;
    acc.cookieCheckedAt = new Date();
    acc.cookieCheckMessage = r.message;
    await acc.save();
    return acc;
  }

  /**
   * Đảm bảo cookie account còn sống trước khi thực hiện service nặng (search,
   * profile job). Nếu cookieAlive đã là `false` → throw 409 ngay, FE mở
   * dialog cập nhật cookie. Nếu chưa probe lần nào (`null`) → probe luôn.
   */
  async assertCookieAlive(accountId: string): Promise<TiktokAccountDocument> {
    const acc = await this.findById(accountId);
    if (acc.cookieAlive === false) {
      throw new ConflictException({
        code: COOKIE_EXPIRED_CODE,
        message: 'Cookie hết hạn — hãy cập nhật cookie mới trước khi tiếp tục.',
        accountId: String(acc._id),
        accountName: acc.name,
        cookieCheckedAt: acc.cookieCheckedAt,
        cookieCheckMessage: acc.cookieCheckMessage,
      });
    }
    if (acc.cookieAlive === null) {
      const fresh = await this.checkCookie(accountId);
      if (!fresh.cookieAlive) {
        throw new ConflictException({
          code: COOKIE_EXPIRED_CODE,
          message:
            'Cookie hết hạn — hãy cập nhật cookie mới trước khi tiếp tục.',
          accountId: String(fresh._id),
          accountName: fresh.name,
          cookieCheckedAt: fresh.cookieCheckedAt,
          cookieCheckMessage: fresh.cookieCheckMessage,
        });
      }
      return fresh;
    }
    return acc;
  }

  /**
   * Lấy marketplace options (danh mục) — categories là TikTok-global theo
   * shop-region nên KHÔNG gắn account cụ thể. Duyệt các account còn sống
   * (`active && cookieAlive !== false`), thử lần lượt đến khi 1 account trả
   * data. Account nào redirect/SDK-dead hoặc auth-fail giữa chừng → mark dead
   * ngay rồi nhảy sang account kế. Hết account → 409 cookie-expired.
   *
   * Ưu tiên account đã xác nhận sống (`cookieAlive=true`) trước account chưa
   * probe (`null`), trong đó account check gần nhất lên trước.
   */
  async marketplaceOptionsAnyAlive(
    region?: string,
  ): Promise<MarketplaceOptionsResult> {
    const query: Record<string, unknown> = {
      active: { $ne: false },
      cookieAlive: { $ne: false }, // true hoặc null (chưa probe)
    };
    if (region) query['shopRegion'] = region;
    const candidates = await this.model
      .find(query)
      .sort({ cookieAlive: -1, cookieCheckedAt: -1 })
      .exec();

    if (!candidates.length) {
      throw new ConflictException({
        code: COOKIE_EXPIRED_CODE,
        message:
          'Không có TikTok account còn sống để tải danh mục. Cập nhật cookie cho ít nhất 1 account.',
      });
    }

    let lastReason: string | undefined;
    for (const acc of candidates) {
      try {
        return await this.tiktok.getMarketplaceOptions({
          cookie: acc.cookie,
          shopId: acc.shopId,
          shopRegion: acc.shopRegion,
        });
      } catch (err) {
        // Chỉ loại + chuyển account với 2 loại lỗi "account có vấn đề".
        // Lỗi khác (network tạm thời, bug code) → bubble lên, không mark dead.
        if (
          err instanceof TiktokSearchAuthError ||
          err instanceof TiktokSessionDeadError
        ) {
          lastReason =
            err instanceof TiktokSearchAuthError
              ? `option_code_${err.code}`
              : 'session_dead';
          await this.markCookieDead(
            String(acc._id),
            `${lastReason}: ${(err.message ?? '').slice(0, 120)}`,
          );
          continue;
        }
        throw err;
      }
    }

    throw new ConflictException({
      code: COOKIE_EXPIRED_CODE,
      message:
        'Tất cả TikTok account đều không tải được danh mục (cookie hết hạn hoặc shopId/quyền affiliate sai). Kiểm tra lại tài khoản.',
      cookieCheckMessage: lastReason,
    });
  }
}
