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
        // Always run both checks: null groupId + stale groupId (refs deleted group)
        await this.assignOrphanAccountsToFirstGroup();
        await this.reassignStaleGroupIdAccounts();
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

  /**
   * Groups already exist → ensure no orphaned accounts remain.
   * Assigns orphans to the earliest-created group as fallback.
   */
  private async assignOrphanAccountsToFirstGroup(): Promise<void> {
    const orphanCount = await this.accModel.countDocuments({
      $or: [{ groupId: { $exists: false } }, { groupId: null }],
    });

    if (orphanCount === 0) return;

    const fallback = await this.groupModel.findOne().sort({ createdAt: 1 });
    if (!fallback) {
      this.logger.warn(
        `Migration: ${orphanCount} orphan accounts found but no groups exist — skipping assignment. Re-create a group and restart.`,
      );
      return;
    }

    const result = await this.accModel.updateMany(
      { $or: [{ groupId: { $exists: false } }, { groupId: null }] },
      { $set: { groupId: fallback._id } },
    );

    this.logger.log(
      `Migration: assigned ${result.modifiedCount} orphan accounts to group "${fallback.name}" (${fallback._id})`,
    );
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
   * Accounts whose groupId references a group that no longer exists in the DB
   * are invisible to all GroupWorkers but NOT counted as orphans (groupId != null).
   * Reassign them to the earliest group.
   */
  private async reassignStaleGroupIdAccounts(): Promise<void> {
    const validGroupIds = await this.groupModel.distinct('_id');
    const fallback = await this.groupModel.findOne().sort({ createdAt: 1 });
    if (!fallback) return;

    const result = await this.accModel.updateMany(
      {
        groupId: {
          $exists: true,
          $ne: null,
          $nin: validGroupIds,
        },
      },
      { $set: { groupId: fallback._id } },
    );

    if (result.modifiedCount > 0) {
      this.logger.log(
        `Migration: reassigned ${result.modifiedCount} accounts with stale groupId → group "${fallback.name}" (${fallback._id})`,
      );
    }
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
