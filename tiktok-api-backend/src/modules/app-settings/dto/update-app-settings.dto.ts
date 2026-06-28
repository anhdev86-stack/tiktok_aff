import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * DTO for PUT /app-settings — partial update of writable fields.
 *
 * Active fields: delayBetweenAccountsMs, delayBetweenLoopsMs.
 * Deprecated fields kept for backward compat until Phase 3 migration.
 * DO NOT add new fields here — use CrawlerGroup DTOs instead.
 */
export class UpdateAppSettingsDto {
  // ─── Active config ────────────────────────────────────────────────────────

  @IsOptional()
  @IsInt()
  @Min(0)
  delayBetweenAccountsMs?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  delayBetweenLoopsMs?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  delayBetweenPagesMs?: number;

  // ─── DEPRECATED — moved to CrawlerGroup. Phase 3 will remove these. ──────

  /** @deprecated Use CrawlerGroup.spreadsheetId */
  @IsOptional()
  @IsString()
  spreadsheetId?: string;

  /** @deprecated Use CrawlerGroup.sheetOverview */
  @IsOptional()
  @IsString()
  sheetOverview?: string;

  /** @deprecated Use CrawlerGroup.sheetTopVideos */
  @IsOptional()
  @IsString()
  sheetTopVideos?: string;

  /** @deprecated Use CrawlerGroup.sheetTrend */
  @IsOptional()
  @IsString()
  sheetTrend?: string;

  /** @deprecated Use CrawlerGroup.enabled */
  @IsOptional()
  @IsBoolean()
  crawlerEnabled?: boolean;

  /** @deprecated Use CrawlerGroup.categoryList */
  @IsOptional()
  @IsArray()
  @IsArray({ each: true })
  @Transform(({ value }: { value: unknown }) => {
    if (!Array.isArray(value)) return value;
    return value.map((item: unknown) => {
      if (
        Array.isArray(item) &&
        item.length === 2 &&
        typeof item[0] === 'string' &&
        typeof item[1] === 'string'
      ) {
        return item as [string, string];
      }
      return item;
    });
  })
  categoryList?: Array<[string, string]>;
}

/**
 * Body for POST /app-settings/test-sheet-access
 */
export class TestSheetAccessDto {
  @IsOptional()
  @IsString()
  spreadsheetId?: string;
}
