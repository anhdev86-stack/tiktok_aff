import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AppSettings,
  type AppSettingsDocument,
} from './schemas/app-settings.schema';
import { type UpdateAppSettingsDto } from './dto/update-app-settings.dto';
import { GoogleSheetsService } from '../google-sheets/google-sheets.service';
import { ServiceAccountService } from '../service-account/service-account.service';

/** Shape returned by testSheetAccess endpoint. */
export interface TestSheetAccessResult {
  spreadsheetId: string;
  allOk: boolean;
  results: Array<{
    saId: string;
    clientEmail: string;
    ok: boolean;
    error?: string;
  }>;
  message?: string;
}

/**
 * Fields that GroupWorker (via CrawlerOrchestratorService) is allowed to update at runtime (internal only).
 * Not exposed through the REST controller.
 * @deprecated These fields moved to CrawlerGroup — kept for legacy compat until Phase 3 migration.
 */
export type CrawlerStatusPatch = Partial<
  Pick<
    AppSettings,
    | 'crawlerStatus'
    | 'currentAccountId'
    | 'lastError'
    | 'lastLoopStartedAt'
    | 'lastLoopFinishedAt'
    | 'loopCount'
    | 'crawlerEnabled'
  >
>;

const SINGLETON_KEY = 'singleton';

@Injectable()
export class AppSettingsService {
  private readonly logger = new Logger(AppSettingsService.name);

  constructor(
    @InjectModel(AppSettings.name)
    private readonly model: Model<AppSettingsDocument>,
    private readonly sheets: GoogleSheetsService,
    private readonly sa: ServiceAccountService,
  ) {}

  /**
   * Get singleton doc. Auto-creates with default values on first call (upsert).
   * KHÔNG cache trong process — mỗi lần đọc DB để user đổi runtime có hiệu lực.
   */
  async get(): Promise<AppSettingsDocument> {
    const doc = await this.model
      .findOneAndUpdate(
        { key: SINGLETON_KEY },
        { $setOnInsert: { key: SINGLETON_KEY } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    // findOneAndUpdate with upsert always returns a document
    return doc!;
  }

  /**
   * Partial update of writable config fields.
   * Uses $set so only provided fields are modified.
   */
  async update(patch: UpdateAppSettingsDto): Promise<AppSettingsDocument> {
    const doc = await this.model
      .findOneAndUpdate(
        { key: SINGLETON_KEY },
        { $set: patch },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    this.logger.log(
      `app-settings updated: fields=[${Object.keys(patch).join(', ')}]`,
    );
    return doc!;
  }

  /**
   * Internal method for updating legacy live status fields (deprecated — Phase 3 will remove).
   * NOT exposed through the REST controller.
   */
  async updateStatus(patch: CrawlerStatusPatch): Promise<void> {
    await this.model
      .findOneAndUpdate(
        { key: SINGLETON_KEY },
        { $set: patch },
        { upsert: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  /**
   * Atomically increment loopCount by 1 using MongoDB $inc.
   * Avoids read-modify-write race when two loops run concurrently (C1 fix).
   */
  async incrementLoopCount(): Promise<void> {
    await this.model
      .findOneAndUpdate(
        { key: SINGLETON_KEY },
        { $inc: { loopCount: 1 } },
        { upsert: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  /**
   * Test whether active Service Accounts have access to the configured spreadsheet.
   * Reads spreadsheetId from current settings if not provided explicitly.
   */
  async testSheetAccess(
    spreadsheetId?: string,
  ): Promise<TestSheetAccessResult> {
    const effectiveId = spreadsheetId ?? (await this.get()).spreadsheetId;

    if (!effectiveId) {
      return {
        spreadsheetId: '',
        allOk: false,
        results: [],
        message: 'Chưa cấu hình spreadsheetId',
      };
    }

    const sas = await this.sa.findActiveDecrypted();
    if (!sas.length) {
      return {
        spreadsheetId: effectiveId,
        allOk: false,
        results: [],
        message: 'Chưa có Service Account nào active.',
      };
    }

    const results = await this.sheets.testAccess(
      effectiveId,
      sas.map((s) => ({
        id: s.id,
        clientEmail: s.clientEmail,
        privateKey: s.privateKey,
      })),
    );

    return {
      spreadsheetId: effectiveId,
      allOk: results.every((r) => r.ok),
      results,
    };
  }
}
