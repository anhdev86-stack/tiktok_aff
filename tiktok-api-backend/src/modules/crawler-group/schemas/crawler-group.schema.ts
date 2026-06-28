import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, Types } from 'mongoose';

export type CrawlerGroupDocument = HydratedDocument<CrawlerGroup>;

/**
 * `crawler_groups` collection — each group is an independent crawler unit.
 * Has its own sheet config, category filter, and live status.
 * Phase 2 will wire CrawlerOrchestrator to manage group workers.
 */
@Schema({ collection: 'crawler_groups', timestamps: true })
export class CrawlerGroup {
  /** Display name — unique. e.g. "VN-Beauty", "SG-Fashion". */
  @Prop({ required: true, unique: true, index: true })
  name!: string;

  // ─── Sheet config (per-group) ─────────────────────────────────────────────

  @Prop({ default: '' })
  spreadsheetId!: string;

  @Prop({ default: 'Tổng quan' })
  sheetOverview!: string;

  @Prop({ default: 'Video nổi bật' })
  sheetTopVideos!: string;

  @Prop({ default: 'Xu hướng' })
  sheetTrend!: string;

  /**
   * Category filter for marketplace search. [] = all categories.
   * Each element is a tuple [categoryId, categoryName].
   */
  @Prop({ type: [[String]], default: [] })
  categoryList!: Array<[string, string]>;

  /** Desire flag — persisted. true = Orchestrator should keep this group running. */
  @Prop({ default: false })
  enabled!: boolean;

  // ─── Live status (written by GroupWorker in Phase 2) ─────────────────────

  @Prop({ default: 'idle' })
  status!: 'idle' | 'running' | 'sleeping' | 'stopping';

  /** ID of account currently being crawled. null = idle. */
  @Prop({ type: Types.ObjectId, ref: 'TiktokAccount', default: null })
  currentAccountId!: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  lastLoopStartedAt!: Date | null;

  @Prop({ type: Date, default: null })
  lastLoopFinishedAt!: Date | null;

  /** Total loops completed for this group. Atomic $inc in incrementLoopCount(). */
  @Prop({ default: 0 })
  loopCount!: number;

  /** Last error message — overwritten on each exception. */
  @Prop({ default: '' })
  lastError!: string;
}

export const CrawlerGroupSchema = SchemaFactory.createForClass(CrawlerGroup);
