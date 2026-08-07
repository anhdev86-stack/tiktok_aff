import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  CrawlerGroup,
  CrawlerGroupDocument,
} from '../modules/crawler-group/schemas/crawler-group.schema';
import {
  TiktokAccount,
  TiktokAccountDocument,
} from '../modules/tiktok-account/schemas/tiktok-account.schema';
import {
  AppSettings,
  AppSettingsDocument,
} from '../modules/app-settings/schemas/app-settings.schema';

/**
 * Idempotent migration: ensures a "Default" CrawlerGroup exists and all
 * TiktokAccounts are assigned to a group.
 *
 * Runs once on every boot via OnModuleInit — safe to re-run (idempotent).
 * Must complete before CrawlerOrchestratorService starts.
 * Wire MigrationsModule import BEFORE CrawlerModule in AppModule to
 * guarantee NestJS initialises this first.
 */
@Injectable()
export class CreateDefaultCrawlerGroupMigration implements OnModuleInit {
  private readonly logger = new Logger(CreateDefaultCrawlerGroupMigration.name);

  constructor(
    @InjectModel(CrawlerGroup.name)
    private readonly groupModel: Model<CrawlerGroupDocument>,
    @InjectModel(TiktokAccount.name)
    private readonly accModel: Model<TiktokAccountDocument>,
    @InjectModel(AppSettings.name)
    private readonly settingsModel: Model<AppSettingsDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      // Idempotent self-heal: cast string-typed groupId → ObjectId. Fixes data
      // được lưu sai bởi các path PATCH cũ (trước khi service cast tường minh).
      // Phải chạy TRƯỚC các check khác để query { groupId: ObjectId } match đúng.
      await this.castStringGroupIdToObjectId();

      const groupCount = await this.groupModel.countDocuments();

      if (groupCount === 0) {
        await this.createDefaultFromLegacySettings();
      } else {
        // Gán account vào ĐÚNG group theo thị trường (shopRegion === region).
        // Thay cho hành vi cũ "dồn mọi account mồ côi/stale về group tạo sớm
        // nhất" — chính là lý do creator MY/PH/TH lẫn vào sheet VN. Pass này
        // cũng TỰ CHỮA account đang bị gán sai group (kéo về đúng thị trường).
        await this.reconcileAccountsByRegion();
      }

      await this.unsetDeprecatedAppSettingsFields();
    } catch (err) {
      this.logger.error(
        'Migration CreateDefaultCrawlerGroup failed',
        (err as Error).stack,
      );
      // Do NOT rethrow — let the app boot and let operator inspect logs.
      // A failed migration should not hard-crash the server on subsequent boots.
    }
  }

  /**
   * No groups exist yet → read legacy app_settings, create Default group,
   * and assign all accounts to it.
   */
  private async createDefaultFromLegacySettings(): Promise<void> {
    // Use .collection to bypass Mongoose schema (legacy fields may be absent from schema)
    const raw = await this.settingsModel.collection.findOne({
      key: 'singleton',
    });

    const defaultGroup = await this.groupModel.create({
      name: 'Default',
      spreadsheetId: (raw?.spreadsheetId as string) ?? '',
      sheetOverview: (raw?.sheetOverview as string) ?? 'Tổng quan',
      sheetTopVideos: (raw?.sheetTopVideos as string) ?? 'Video nổi bật',
      sheetTrend: (raw?.sheetTrend as string) ?? 'Xu hướng',
      categoryList: (raw?.categoryList as Array<[string, string]>) ?? [],
      enabled: !!raw?.crawlerEnabled,
    });

    const result = await this.accModel.updateMany(
      { $or: [{ groupId: { $exists: false } }, { groupId: null }] },
      { $set: { groupId: defaultGroup._id } },
    );

    this.logger.log(
      `Migration: created Default group (${defaultGroup._id}), assigned ${result.modifiedCount} accounts`,
    );
  }

  /** Chuẩn hoá region để so khớp: trim + upper. '' nếu rỗng. */
  private normRegion(r: unknown): string {
    return typeof r === 'string' ? r.trim().toUpperCase() : '';
  }

  /**
   * Gán MỌI account vào group đúng thị trường của nó (account.shopRegion khớp
   * group.region, không phân biệt hoa/thường). Đây là bản thay thế cho lối cũ
   * "dồn account mồ côi/stale về group tạo sớm nhất" — thứ đã trộn creator
   * MY/PH/TH vào sheet VN. Xử lý gọn cả 3 trường hợp trong một pass:
   *
   *   - mồ côi   (groupId null)            → gán vào group cùng region
   *   - stale    (groupId trỏ group đã xoá) → gán lại vào group cùng region
   *   - gán sai  (đang ở group khác region) → KÉO về group cùng region
   *
   * NGUYÊN TẮC AN TOÀN: chỉ DI CHUYỂN account khi tồn tại DUY NHẤT một group
   * cùng region. Nếu region chưa cấu hình (không group nào match) hoặc bị nhập
   * trùng cho ≥2 group (nhập nhằng) → KHÔNG đụng account đang ở group hợp lệ,
   * chỉ cảnh báo log. Nhờ vậy, deploy code này khi các group CHƯA set region là
   * gần như no-op (trừ việc thôi dồn account mồ côi vào VN) — an toàn tuyệt đối.
   */
  private async reconcileAccountsByRegion(): Promise<void> {
    const groups = await this.groupModel
      .find({}, { _id: 1, name: 1, region: 1 })
      .lean();

    // region (normalized) → danh sách group. >1 phần tử = nhập nhằng, bỏ qua.
    const byRegion = new Map<string, Array<{ _id: unknown; name: string }>>();
    for (const g of groups) {
      const key = this.normRegion(g.region);
      if (!key) continue; // group chưa gán region → không dùng để match
      const arr = byRegion.get(key) ?? [];
      arr.push({ _id: g._id, name: g.name });
      byRegion.set(key, arr);
    }

    const validGroupIds = new Set(groups.map((g) => String(g._id)));

    const accounts = await this.accModel
      .find({}, { _id: 1, name: 1, shopRegion: 1, groupId: 1 })
      .lean();

    let moved = 0;
    let orphanedNoMatch = 0;
    const ambiguousRegions = new Set<string>();

    for (const acc of accounts) {
      const key = this.normRegion(acc.shopRegion);
      const matches = key ? byRegion.get(key) : undefined;
      const currentGroupId = acc.groupId ? String(acc.groupId) : null;
      const isStale =
        currentGroupId != null && !validGroupIds.has(currentGroupId);
      const isOrphan = currentGroupId == null;

      if (matches && matches.length === 1) {
        const target = matches[0];
        if (currentGroupId !== String(target._id)) {
          await this.accModel.updateOne(
            { _id: acc._id },
            { $set: { groupId: target._id } },
          );
          moved++;
          this.logger.log(
            `Migration: account "${acc.name}" (region=${acc.shopRegion}) → group "${target.name}"` +
              (isOrphan
                ? ' [mồ côi]'
                : isStale
                  ? ' [stale]'
                  : ' [gán sai thị trường]'),
          );
        }
        continue;
      }

      if (matches && matches.length > 1) {
        ambiguousRegions.add(key);
      }

      // Không có group đúng region (hoặc nhập nhằng): chỉ dọn account mồ
      // côi/stale về null cho sạch UI; KHÔNG đụng account đang ở group hợp lệ.
      if (isOrphan || isStale) {
        if (isStale) {
          await this.accModel.updateOne(
            { _id: acc._id },
            { $set: { groupId: null } },
          );
        }
        orphanedNoMatch++;
      }
    }

    if (moved > 0) {
      this.logger.log(`Migration: đã gán lại ${moved} account theo thị trường`);
    }
    if (orphanedNoMatch > 0) {
      this.logger.warn(
        `Migration: ${orphanedNoMatch} account chưa có group đúng thị trường ` +
          `(shopRegion không khớp region group nào) — hãy tạo/gán region cho ` +
          `group tương ứng rồi restart, hoặc gán tay trong UI`,
      );
    }
    if (ambiguousRegions.size > 0) {
      this.logger.warn(
        `Migration: các thị trường bị gán cho >1 group (nhập nhằng, đã bỏ qua): ` +
          `${[...ambiguousRegions].join(', ')} — mỗi thị trường chỉ nên có 1 group`,
      );
    }
  }

  /**
   * Tự heal khi groupId được lưu dạng string thay vì ObjectId (xảy ra với code cũ
   * gửi plain object qua findByIdAndUpdate). Query `{ groupId: ObjectId }` không
   * match string → worker thấy 0 account dù DB có data. Convert tại chỗ qua native
   * collection (Mongoose strict mode sẽ chặn $set với BSON type mismatch).
   */
  private async castStringGroupIdToObjectId(): Promise<void> {
    const coll = this.accModel.collection;
    const stringDocs = await coll
      .find(
        { groupId: { $type: 'string' } },
        { projection: { _id: 1, groupId: 1 } },
      )
      .toArray();

    if (stringDocs.length === 0) return;

    const { Types } = await import('mongoose');
    let converted = 0;
    let skipped = 0;
    for (const d of stringDocs) {
      const raw = d.groupId as unknown as string;
      if (!Types.ObjectId.isValid(raw)) {
        skipped++;
        continue;
      }
      await coll.updateOne(
        { _id: d._id },
        { $set: { groupId: new Types.ObjectId(raw) } },
      );
      converted++;
    }

    this.logger.log(
      `Migration: cast ${converted} account.groupId từ string → ObjectId` +
        (skipped > 0 ? ` (bỏ qua ${skipped} string không hợp lệ)` : ''),
    );
  }

  /**
   * $unset deprecated fields from app_settings singleton.
   * Idempotent — safe to run even if fields are already absent.
   */
  private async unsetDeprecatedAppSettingsFields(): Promise<void> {
    await this.settingsModel.collection.updateOne(
      { key: 'singleton' },
      {
        $unset: {
          spreadsheetId: '',
          sheetOverview: '',
          sheetTopVideos: '',
          sheetTrend: '',
          categoryList: '',
          crawlerEnabled: '',
          crawlerStatus: '',
          currentAccountId: '',
          lastLoopStartedAt: '',
          lastLoopFinishedAt: '',
          loopCount: '',
          lastError: '',
        },
      },
    );
  }
}
