/**
 * CrawlerWriteSheets — builds the Overview (Tổng quan) worksheet payload and
 * APPENDS chỉ creator mới (insert-only theo 'OEC ID'). Ngoại lệ duy nhất: ô 'Bio'
 * đang TRỐNG của dòng đã có được vá bù (xem backfillColumns trong appendNewRows).
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

/**
 * Creator "bán qua LIVE" = có `LIVE GMV > 0`. `pickMoneyValue` cho ra
 * `number | null`, nên chỉ cần giữ số dương. Đây là lọc HẬU KỲ trên pool mà
 * crawler đã lấy (không đụng tới việc ký/gọi TikTok) — an toàn tuyệt đối với
 * pipeline đang chạy. Muốn coverage rộng hơn thì thêm filter LIVE thật vào
 * /marketplace/find (cần capture payload từ UI affiliate).
 */
function filterLiveProfiles(
  profiles: CreatorFullProfile[],
): CreatorFullProfile[] {
  return profiles.filter((p) => {
    const gmv = p.overview.row['LIVE GMV'];
    return typeof gmv === 'number' && gmv > 0;
  });
}

@Injectable()
export class CrawlerWriteSheets {
  private readonly logger = new Logger(CrawlerWriteSheets.name);

  constructor(private readonly sheets: GoogleSheetsService) {}

  /**
   * Ghi sheet Tổng quan (Overview) — INSERT-ONLY theo 'OEC ID': chỉ APPEND
   * creator CHƯA có vào ĐÁY sheet, BỎ QUA creator đã tồn tại (không update,
   * không ghi đè), KHÔNG đụng dòng cũ → không bao giờ mất creator đã có.
   * Riêng ô 'Bio' trống của dòng cũ thì được vá (backfillColumns) — nếu không,
   * creator bị lỗi /profile lần đầu sẽ mất Bio vĩnh viễn.
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
      // Bio chỉ có từ /profile, call đó fail lẻ là chuyện thường. Vì sheet là
      // insert-only, dòng đã ghi thiếu Bio sẽ không bao giờ được sửa → cho phép
      // vá riêng ô Bio khi nó đang trống (xem appendNewRows).
      backfillColumns: ['Bio'],
    });

    this.logger.log(
      `[${shopName}] sheet Tổng quan via SA=${result.saUsed} ` +
        `+${result.appended} mới` +
        (result.backfilled > 0 ? `, vá ${result.backfilled} Bio` : '') +
        ` (tổng ${result.dataRowCount} creator)`,
    );

    const perSheet: Record<string, number> = {
      [group.sheetOverview]: result.dataRowCount,
    };
    const sheetIds: Record<string, number> = {
      [group.sheetOverview]: result.sheetId,
    };

    // ─── Sheet Creator LIVE (tập con: LIVE GMV > 0) ──────────────────────────
    // Doc group cũ có thể thiếu `sheetLive` → fallback tên mặc định.
    const liveTitle = group.sheetLive || 'Creator LIVE';
    const liveProfiles = filterLiveProfiles(profiles);
    if (liveProfiles.length > 0) {
      const liveRows = buildOverviewRows(shopName, liveProfiles);
      const liveResult = await this.sheets.appendNewRows({
        spreadsheetId: group.spreadsheetId,
        title: liveTitle,
        header: [...OVERVIEW_HEADER],
        rows: liveRows,
        keyColumn: 'OEC ID',
        backfillColumns: ['Bio'],
      });
      perSheet[liveTitle] = liveResult.dataRowCount;
      sheetIds[liveTitle] = liveResult.sheetId;
      this.logger.log(
        `[${shopName}] sheet ${liveTitle} via SA=${liveResult.saUsed} ` +
          `+${liveResult.appended} LIVE mới` +
          (liveResult.backfilled > 0 ? `, vá ${liveResult.backfilled} Bio` : '') +
          ` (tổng ${liveResult.dataRowCount} creator LIVE)`,
      );
    }

    // Trả perSheet = tổng data row + sheetId để formatAll() format đúng vùng.
    return { perSheet, sheetIds };
  }

  /**
   * Backfill 1 lần: quét sheet Tổng quan hiện có → copy mọi creator có
   * LIVE GMV > 0 sang sheet "Creator LIVE". Insert-only theo 'OEC ID' (chạy
   * lại nhiều lần an toàn, không nhân đôi). Dùng để lấp sheet LIVE ngay từ
   * hàng chục nghìn creator ĐÃ crawl, khỏi chờ crawler quét lại.
   *
   * Map cột theo TÊN header đọc từ sheet (không giả định thứ tự cột) rồi dựng
   * lại đúng layout OVERVIEW_HEADER trước khi ghi.
   */
  async backfillLive(
    group: CrawlerGroupDocument,
  ): Promise<{ scanned: number; live: number; appended: number; dataRowCount: number }> {
    const liveTitle = group.sheetLive || 'Creator LIVE';
    const { header, rows } = await this.sheets.readRows({
      spreadsheetId: group.spreadsheetId,
      title: group.sheetOverview,
    });

    if (rows.length === 0) {
      this.logger.log(
        `[backfill LIVE] sheet "${group.sheetOverview}" trống — không có gì để gom`,
      );
      return { scanned: 0, live: 0, appended: 0, dataRowCount: 0 };
    }

    // Vị trí cột theo tên (header sheet có thể lệch thứ tự với OVERVIEW_HEADER).
    const idxOf = (name: string) =>
      (header as unknown[]).findIndex((h) => String(h) === name);
    const liveIdx = idxOf('LIVE GMV');
    if (liveIdx < 0) {
      throw new Error(
        `Sheet "${group.sheetOverview}" không có cột 'LIVE GMV' — không backfill được`,
      );
    }

    // Lọc creator LIVE rồi dựng lại từng dòng đúng thứ tự OVERVIEW_HEADER.
    const liveRows: (string | number | boolean)[][] = [];
    for (const row of rows) {
      const gmv = Number(row[liveIdx]);
      if (!Number.isFinite(gmv) || gmv <= 0) continue;
      liveRows.push(
        (OVERVIEW_HEADER as readonly string[]).map((h) => {
          const i = idxOf(h);
          return i >= 0 ? normalizeCell(row[i]) : '';
        }),
      );
    }

    if (liveRows.length === 0) {
      this.logger.log(
        `[backfill LIVE] quét ${rows.length} creator, 0 có LIVE GMV > 0 ` +
          `(enrich /profile có đang bật không?)`,
      );
      return { scanned: rows.length, live: 0, appended: 0, dataRowCount: 0 };
    }

    const result = await this.sheets.appendNewRows({
      spreadsheetId: group.spreadsheetId,
      title: liveTitle,
      header: [...OVERVIEW_HEADER],
      rows: liveRows,
      keyColumn: 'OEC ID',
      backfillColumns: ['Bio'],
    });

    await this.formatAll(group, {
      perSheet: { [liveTitle]: result.dataRowCount },
      sheetIds: { [liveTitle]: result.sheetId },
    }).catch(() => undefined);

    this.logger.log(
      `[backfill LIVE] quét ${rows.length} creator → ${liveRows.length} LIVE, ` +
        `+${result.appended} mới vào "${liveTitle}" (tổng ${result.dataRowCount})`,
    );
    return {
      scanned: rows.length,
      live: liveRows.length,
      appended: result.appended,
      dataRowCount: result.dataRowCount,
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
      // Sheet LIVE dùng chung cột/format với Tổng quan. Chỉ được format khi lượt
      // này có ghi (filter `sheetIds[title] != null` bên dưới lo phần bỏ qua).
      {
        title: group.sheetLive || 'Creator LIVE',
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
