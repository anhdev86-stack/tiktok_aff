/**
 * CrawlerWriteSheets — builds the Overview (Tổng quan) worksheet payload and
 * APPENDS chỉ creator mới (insert-only theo 'OEC ID', không update dòng cũ).
 * Each row is prefixed with acc.name as the "Shop" column value. (2 sheet cũ
 * Video nổi bật / Xu hướng đã bỏ để tăng tốc crawl.)
 *
 * Phase 2: write() now accepts CrawlerGroupDocument (per-group sheet config)
 * instead of AppSettingsDocument. spreadsheetId + sheet names come from group.
 */
import { Injectable, Logger } from '@nestjs/common';
import { GoogleSheetsService } from '../google-sheets/google-sheets.service';
import {
  OVERVIEW_HEADER,
  OVERVIEW_COL_SPECS,
} from '../tiktok-client/flatten.util';
import type { CreatorFullProfile } from '../tiktok-client/tiktok-client.service';
import type { CrawlerGroupDocument } from '../crawler-group/schemas/crawler-group.schema';
import type { TiktokAccountDocument } from '../tiktok-account/schemas/tiktok-account.schema';

/** Coerce cell to string | number | boolean — mirrors profile-job normalizeCell. */
function normalizeCell(v: unknown): string | number | boolean {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
    return v;
  return String(v);
}

/**
 * Build overview matrix: each row starts with acc.name (Shop), then the
 * remaining OVERVIEW_HEADER columns from flattenOverview result.
 */
function buildOverviewRows(
  shopName: string,
  profiles: CreatorFullProfile[],
): (string | number | boolean)[][] {
  // OVERVIEW_HEADER[0] = 'Shop' — slice(1) gives the flatten-owned columns
  const restHeaders = OVERVIEW_HEADER.slice(1) as readonly string[];
  return profiles.map((p) => [
    shopName,
    ...restHeaders.map((h) => normalizeCell(p.overview.row[h])),
  ]);
}

@Injectable()
export class CrawlerWriteSheets {
  private readonly logger = new Logger(CrawlerWriteSheets.name);

  constructor(private readonly sheets: GoogleSheetsService) {}

  /**
   * Ghi sheet Tổng quan (Overview) — INSERT-ONLY theo 'OEC ID': chỉ APPEND
   * creator CHƯA có vào ĐÁY sheet, BỎ QUA creator đã tồn tại (không update,
   * không ghi đè), KHÔNG đụng dòng cũ → không bao giờ mất creator đã có.
   *
   * Creator trùng OEC ID (kể cả do shop khác đã crawl) chỉ được ghi 1 lần đầu;
   * lần gặp sau bỏ qua. Cột 'Shop' giữ tên shop ghi đầu tiên.
   * Sheet config (spreadsheetId, sheet names) lấy từ group (Phase 2).
   */
  async write(
    acc: TiktokAccountDocument,
    group: CrawlerGroupDocument,
    profiles: CreatorFullProfile[],
  ): Promise<{
    perSheet: Record<string, number>;
    sheetIds: Record<string, number>;
  }> {
    const shopName = acc.name;

    const overviewRows = buildOverviewRows(shopName, profiles);

    const result = await this.sheets.appendNewRows({
      spreadsheetId: group.spreadsheetId,
      title: group.sheetOverview,
      header: [...OVERVIEW_HEADER],
      rows: overviewRows,
      keyColumn: 'OEC ID',
    });

    this.logger.log(
      `[${shopName}] sheet Tổng quan via SA=${result.saUsed} ` +
        `+${result.appended} mới (tổng ${result.dataRowCount} creator)`,
    );

    // Trả perSheet = tổng data row + sheetId để formatAll() format đúng vùng.
    return {
      perSheet: { [group.sheetOverview]: result.dataRowCount },
      sheetIds: { [group.sheetOverview]: result.sheetId },
    };
  }

  /**
   * Format sheet Tổng quan 1 LẦN (cuối vòng account) thay vì mỗi page.
   * dataRowCount lấy từ kết quả write page cuối (upsertOne trả tổng dòng sheet
   * sau merge). Lỗi format chỉ ảnh hưởng hiển thị → caller nên nuốt, không fail.
   */
  async formatAll(
    group: CrawlerGroupDocument,
    last: {
      perSheet: Record<string, number>;
      sheetIds: Record<string, number>;
    },
  ): Promise<void> {
    const specs = [
      {
        title: group.sheetOverview,
        header: [...OVERVIEW_HEADER],
        columnSpecs: OVERVIEW_COL_SPECS,
      },
    ];
    const sheets = specs
      .filter((s) => last.sheetIds[s.title] != null)
      .map((s) => ({
        title: s.title,
        sheetId: last.sheetIds[s.title],
        header: s.header,
        dataRowCount: last.perSheet[s.title] ?? 0,
        columnSpecs: s.columnSpecs,
      }));
    if (!sheets.length) return;
    await this.sheets.applyFormatAll({
      spreadsheetId: group.spreadsheetId,
      sheets,
    });
  }
}
