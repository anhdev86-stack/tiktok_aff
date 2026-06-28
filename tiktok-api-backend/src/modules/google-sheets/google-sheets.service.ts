import { Injectable, Logger } from '@nestjs/common';
import { google, type sheets_v4 } from 'googleapis';
import { JWT } from 'google-auth-library';
import { SaRotatorService, type SaPick } from './sa-rotator.service';
import type { ColumnSpec, ColumnType } from '../tiktok-client/flatten.util';

export interface WorksheetUpsert {
  /** Tên worksheet (sẽ tự tạo nếu chưa có) */
  title: string;
  /** Hàng đầu tiên = header */
  header: string[];
  /** Các hàng dữ liệu mới (mỗi hàng = mảng giá trị theo thứ tự header) */
  rows: unknown[][];
  /**
   * Tên các cột tạo nên primary key (logic upsert).
   * Vd: ['oec_id'] cho overview, ['creator_oec_id', 'kind', 'video_id']
   * cho top_videos.
   */
  keyColumns: string[];
  /**
   * Định dạng cột cho Sheets — header (header row) sẽ luôn được style đậm.
   * Per-column type quyết định alignment + numberFormat + width policy.
   * Optional: nếu không truyền → chỉ format header + freeze row 1.
   */
  columnSpecs?: Record<string, ColumnSpec>;
}

const HEADER_BG = { red: 0x1f / 255, green: 0x4e / 255, blue: 0x78 / 255 };
const HEADER_FG = { red: 1, green: 1, blue: 1 };
const BAND_FIRST = { red: 1, green: 1, blue: 1 };
const BAND_SECOND = { red: 0xf3 / 255, green: 0xf6 / 255, blue: 0xf9 / 255 };
const BORDER_GREY = { red: 0.85, green: 0.85, blue: 0.85 };
const LONG_TEXT_WIDTH_PX = 320;

@Injectable()
export class GoogleSheetsService {
  private readonly logger = new Logger(GoogleSheetsService.name);
  // Per-spreadsheet serialization để tránh race khi 2 job cùng đọc bandedRangeId
  // rồi cùng deleteBanding với cùng ID → "No BandedRange with id" ở job thứ 2.
  // Map<spreadsheetId, lastPromise>: chuỗi promise theo từng spreadsheet.
  private sheetLocks = new Map<string, Promise<unknown>>();

  private async withSheetLock<T>(
    spreadsheetId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const prev = this.sheetLocks.get(spreadsheetId) ?? Promise.resolve();
    let release: () => void = () => {};
    const wait = new Promise<void>((r) => {
      release = r;
    });
    // Giữ chính ref promise đã set vào Map để so sánh khi cleanup. Trước đây
    // dùng `prev.then(() => wait)` lần 2 ở finally tạo promise MỚI → !== ref đã
    // set → điều kiện luôn false → Map không bao giờ được dọn (leak).
    const chained = prev.then(() => wait);
    this.sheetLocks.set(spreadsheetId, chained);
    try {
      await prev; // chờ job trước hoàn tất
      return await fn();
    } finally {
      release();
      // Cleanup khi mình là job cuối cùng trong chain (không ai nối tiếp sau).
      if (this.sheetLocks.get(spreadsheetId) === chained) {
        this.sheetLocks.delete(spreadsheetId);
      }
    }
  }

  constructor(private readonly rotator: SaRotatorService) {}

  private buildClient(pick: SaPick): sheets_v4.Sheets {
    const auth = new JWT({
      email: pick.clientEmail,
      key: pick.privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return google.sheets({ version: 'v4', auth });
  }

  /**
   * Upsert nhiều worksheet trong cùng 1 spreadsheet.
   * - Tạo worksheet nếu chưa có
   * - Đọc data hiện có, build map theo `keyColumns`
   * - Với mỗi row mới: nếu trùng key → update, nếu chưa có → append
   * - Header sẽ được union với header hiện có để không mất cột cũ
   * - Sau khi ghi: apply formatting (header style + per-column number format
   *   + autoResize + banding + freeze row 1)
   * - Tự động retry với SA tiếp theo khi gặp rate limit (429)
   */
  async upsertWorksheets(params: {
    spreadsheetId: string;
    worksheets: WorksheetUpsert[];
    /**
     * Skip applyFormat (header style, banding, freeze, autoResize).
     * Dùng khi streaming: gọi upsert nhiều lần trong job, chỉ format 1 lần
     * cuối cùng qua `applyFormatAll` để né race deleteBanding.
     */
    skipFormat?: boolean;
  }): Promise<{
    saUsed: string;
    perSheet: Record<string, number>;
    sheetIds: Record<string, number>;
  }> {
    // Serialize per-spreadsheet để tránh race trong applyFormat (deleteBanding
    // dựa trên snapshot bandedRangeId — 2 job song song = ID stale ở job thứ 2).
    return this.withSheetLock(params.spreadsheetId, () =>
      this.rotator.withRotation(async (pick) => {
        const sheets = this.buildClient(pick);

        const meta = await sheets.spreadsheets.get({
          spreadsheetId: params.spreadsheetId,
        });
        const titleToSheetId = new Map<string, number>();
        for (const s of meta.data.sheets ?? []) {
          const t = s.properties?.title;
          const id = s.properties?.sheetId;
          if (t && id != null) titleToSheetId.set(t, id);
        }

        const toCreate = params.worksheets
          .filter((w) => !titleToSheetId.has(w.title))
          .map((w) => ({ addSheet: { properties: { title: w.title } } }));
        if (toCreate.length) {
          const res = await sheets.spreadsheets.batchUpdate({
            spreadsheetId: params.spreadsheetId,
            requestBody: { requests: toCreate },
          });
          for (const reply of res.data.replies ?? []) {
            const props = reply.addSheet?.properties;
            if (props?.title && props.sheetId != null) {
              titleToSheetId.set(props.title, props.sheetId);
            }
          }
        }

        const perSheet: Record<string, number> = {};
        const sheetIdsOut: Record<string, number> = {};
        for (const w of params.worksheets) {
          const sheetId = titleToSheetId.get(w.title);
          if (sheetId == null) {
            this.logger.warn(
              `Không lấy được sheetId cho "${w.title}" — bỏ format`,
            );
            continue;
          }
          sheetIdsOut[w.title] = sheetId;
          const written = await this.upsertOne(
            sheets,
            params.spreadsheetId,
            sheetId,
            w,
            { skipFormat: params.skipFormat ?? false },
          );
          perSheet[w.title] = written;
        }

        return {
          saUsed: pick.clientEmail,
          perSheet,
          sheetIds: sheetIdsOut,
        };
      }),
    );
  }

  /**
   * Reset sheets về trạng thái sạch (clear values + write header).
   * Gọi 1 lần ở đầu job streaming, dùng 1 SA (rotation pick).
   */
  async resetSheets(params: {
    spreadsheetId: string;
    sheets: Array<{ title: string; header: string[] }>;
  }): Promise<{ saUsed: string; sheetIds: Record<string, number> }> {
    return this.withSheetLock(params.spreadsheetId, () =>
      this.rotator.withRotation(async (pick) => {
        const sheets = this.buildClient(pick);
        const meta = await sheets.spreadsheets.get({
          spreadsheetId: params.spreadsheetId,
        });
        const titleToSheetId = new Map<string, number>();
        for (const s of meta.data.sheets ?? []) {
          const t = s.properties?.title;
          const id = s.properties?.sheetId;
          if (t && id != null) titleToSheetId.set(t, id);
        }
        // Tạo sheet thiếu
        const toCreate = params.sheets
          .filter((w) => !titleToSheetId.has(w.title))
          .map((w) => ({ addSheet: { properties: { title: w.title } } }));
        if (toCreate.length) {
          const res = await sheets.spreadsheets.batchUpdate({
            spreadsheetId: params.spreadsheetId,
            requestBody: { requests: toCreate },
          });
          for (const reply of res.data.replies ?? []) {
            const props = reply.addSheet?.properties;
            if (props?.title && props.sheetId != null) {
              titleToSheetId.set(props.title, props.sheetId);
            }
          }
        }
        // Clear + ghi header cho từng sheet
        const sheetIds: Record<string, number> = {};
        for (const w of params.sheets) {
          const sheetId = titleToSheetId.get(w.title);
          if (sheetId == null) continue;
          sheetIds[w.title] = sheetId;
          await sheets.spreadsheets.values.clear({
            spreadsheetId: params.spreadsheetId,
            range: `${w.title}!A1:ZZ`,
          });
          await sheets.spreadsheets.values.update({
            spreadsheetId: params.spreadsheetId,
            range: `${w.title}!A1`,
            valueInputOption: 'RAW',
            requestBody: { values: [w.header] },
          });
        }
        return { saUsed: pick.clientEmail, sheetIds };
      }),
    );
  }

  /**
   * Append rows (no merge) — dùng cho streaming write trong job.
   * Mỗi call = 1 SA (round-robin), tự throttle giữa chunks lớn.
   *
   * QUAN TRỌNG: dùng `update` với range explicit (tính từ row count hiện có)
   * thay vì `append` với `A1` — append + range hẹp khiến API chỉ ghi vào
   * column A (leak data ra columns B+ rỗng). Tự count current rows trước
   * mỗi flush.
   */
  async appendStream(params: {
    spreadsheetId: string;
    sheets: Array<{ title: string; rows: unknown[][] }>;
  }): Promise<{ saUsed: string; appended: Record<string, number> }> {
    return this.withSheetLock(params.spreadsheetId, () =>
      this.rotator.withRotation(async (pick) => {
        const sheets = this.buildClient(pick);
        const appended: Record<string, number> = {};

        // Lấy meta tất cả sheet 1 lần (sheetId + grid size hiện tại) để
        // expand grid khi cần (default sheet chỉ 1000 rows × 26 cols).
        const meta = await sheets.spreadsheets.get({
          spreadsheetId: params.spreadsheetId,
          fields: 'sheets(properties(sheetId,title,gridProperties))',
        });
        const sheetMeta = new Map<
          string,
          { sheetId: number; rowCount: number; colCount: number }
        >();
        for (const s of meta.data.sheets ?? []) {
          const t = s.properties?.title;
          const id = s.properties?.sheetId;
          if (t && id != null) {
            sheetMeta.set(t, {
              sheetId: id,
              rowCount: s.properties?.gridProperties?.rowCount ?? 1000,
              colCount: s.properties?.gridProperties?.columnCount ?? 26,
            });
          }
        }

        for (const w of params.sheets) {
          if (w.rows.length === 0) {
            appended[w.title] = 0;
            continue;
          }
          // Lấy số dòng đang có (header + data) để biết bắt đầu ghi từ row nào
          const colVals = await sheets.spreadsheets.values.get({
            spreadsheetId: params.spreadsheetId,
            range: `${w.title}!A:A`,
            majorDimension: 'COLUMNS',
          });
          const currentRowCount = (colVals.data.values?.[0]?.length ?? 0) || 0;
          const startRow = currentRowCount + 1;

          const colCount = w.rows[0]?.length ?? 0;
          const endCol = colLetter(colCount);
          const finalRow = startRow + w.rows.length - 1;

          // Expand grid nếu cần (default sheet 1000 rows × 26 cols).
          // +1000 buffer để không phải expand mỗi flush.
          const m = sheetMeta.get(w.title);
          if (m) {
            const needRows = finalRow + 1000;
            const needCols = Math.max(colCount, 26);
            const updates: sheets_v4.Schema$Request[] = [];
            if (m.rowCount < needRows || m.colCount < needCols) {
              updates.push({
                updateSheetProperties: {
                  properties: {
                    sheetId: m.sheetId,
                    gridProperties: {
                      rowCount: Math.max(m.rowCount, needRows),
                      columnCount: Math.max(m.colCount, needCols),
                    },
                  },
                  fields: 'gridProperties.rowCount,gridProperties.columnCount',
                },
              });
            }
            if (updates.length) {
              await sheets.spreadsheets.batchUpdate({
                spreadsheetId: params.spreadsheetId,
                requestBody: { requests: updates },
              });
              m.rowCount = Math.max(m.rowCount, needRows);
              m.colCount = Math.max(m.colCount, needCols);
            }
          }

          // Chunk 1000 rows mỗi lần để né API limit
          const CHUNK_SIZE = 1000;
          let total = 0;
          let rowCursor = startRow;
          for (let s = 0; s < w.rows.length; s += CHUNK_SIZE) {
            const chunk = w.rows.slice(s, s + CHUNK_SIZE);
            const endRow = rowCursor + chunk.length - 1;
            await sheets.spreadsheets.values.update({
              spreadsheetId: params.spreadsheetId,
              range: `${w.title}!A${rowCursor}:${endCol}${endRow}`,
              valueInputOption: 'RAW',
              requestBody: { values: chunk },
            });
            rowCursor = endRow + 1;
            total += chunk.length;
            if (s + CHUNK_SIZE < w.rows.length) {
              await new Promise((r) => setTimeout(r, 200));
            }
          }
          appended[w.title] = total;
        }
        return { saUsed: pick.clientEmail, appended };
      }),
    );
  }

  /**
   * INSERT-ONLY theo key: chỉ APPEND creator CHƯA có vào ĐÁY sheet, BỎ QUA
   * creator đã tồn tại (không update, không ghi đè), KHÔNG đụng các dòng cũ.
   *
   * Khác `upsertWorksheets` (đọc + merge + ghi đè TOÀN BỘ sheet → update dòng
   * trùng): hàm này chỉ đọc cột key để biết key nào đã có, rồi ghi phần dòng
   * mới xuống dưới cùng. Lợi: (1) không bao giờ mất/đổi dòng đã có; (2) nhẹ hơn
   * nhiều khi sheet lớn (chỉ ghi phần mới thay vì rewrite ~10k dòng mỗi page).
   *
   * Dedupe 2 lớp: bỏ key đã có trên sheet + bỏ key trùng trong chính batch.
   * Header lệch thứ tự vẫn map đúng theo tên cột; sheet trống thì tự ghi header.
   */
  async appendNewRows(params: {
    spreadsheetId: string;
    title: string;
    header: string[];
    rows: unknown[][];
    keyColumn: string;
  }): Promise<{
    saUsed: string;
    appended: number;
    dataRowCount: number;
    sheetId: number;
  }> {
    return this.withSheetLock(params.spreadsheetId, () =>
      this.rotator.withRotation(async (pick) => {
        const sheets = this.buildClient(pick);

        // 1) sheetId + grid size (tạo sheet nếu chưa có).
        const meta = await sheets.spreadsheets.get({
          spreadsheetId: params.spreadsheetId,
          fields: 'sheets(properties(sheetId,title,gridProperties))',
        });
        let sheetId: number | undefined;
        let gridRows = 1000;
        let gridCols = 26;
        for (const s of meta.data.sheets ?? []) {
          if (s.properties?.title === params.title) {
            sheetId = s.properties?.sheetId ?? undefined;
            gridRows = s.properties?.gridProperties?.rowCount ?? 1000;
            gridCols = s.properties?.gridProperties?.columnCount ?? 26;
          }
        }
        if (sheetId == null) {
          const res = await sheets.spreadsheets.batchUpdate({
            spreadsheetId: params.spreadsheetId,
            requestBody: {
              requests: [{ addSheet: { properties: { title: params.title } } }],
            },
          });
          const props = res.data.replies?.[0]?.addSheet?.properties;
          sheetId = props?.sheetId ?? undefined;
          gridRows = props?.gridProperties?.rowCount ?? 1000;
          gridCols = props?.gridProperties?.columnCount ?? 26;
        }
        if (sheetId == null) {
          throw new Error(`Không lấy được sheetId cho "${params.title}"`);
        }

        // 2) Đọc header (chỉ row 1) — KHÔNG đọc cả sheet để nhẹ khi data lớn.
        const headerRes = await sheets.spreadsheets.values.get({
          spreadsheetId: params.spreadsheetId,
          range: `${params.title}!A1:ZZ1`,
        });
        const existingHeader = (headerRes.data.values?.[0] ?? []) as string[];
        const hasHeader = existingHeader.length > 0;

        // Header dùng để ghi: sheet trống → header truyền vào; đã có → giữ
        // header cũ, union cột mới (nếu schema đổi) để không lệch dòng.
        const mergedHeader = hasHeader
          ? [...existingHeader]
          : [...params.header];
        if (hasHeader) {
          for (const col of params.header) {
            if (!mergedHeader.includes(col)) mergedHeader.push(col);
          }
        }
        const keyIdx = mergedHeader.indexOf(params.keyColumn);
        if (keyIdx < 0) {
          throw new Error(
            `Key column "${params.keyColumn}" không có trong header`,
          );
        }

        // 3) Đọc CỘT key (toàn bộ) để biết key đã tồn tại + đếm số dòng hiện có.
        const keyColLetter = colLetter(keyIdx + 1);
        const keyColRes = await sheets.spreadsheets.values.get({
          spreadsheetId: params.spreadsheetId,
          range: `${params.title}!${keyColLetter}:${keyColLetter}`,
          majorDimension: 'COLUMNS',
        });
        const keyColCells = (keyColRes.data.values?.[0] ?? []) as string[];
        // Dòng đầu là header → key data bắt đầu từ index 1.
        const existingKeys = new Set<string>();
        for (let i = 1; i < keyColCells.length; i++) {
          const k = String(keyColCells[i] ?? '').trim();
          if (k) existingKeys.add(k);
        }
        // Tổng số dòng đang dùng (header + data). Sheet trống chưa có header → 0.
        const currentTotalRows = hasHeader
          ? Math.max(keyColCells.length, 1)
          : 0;
        const dataRowCountBefore = hasHeader
          ? Math.max(currentTotalRows - 1, 0)
          : 0;

        // 4) Lọc incoming: chỉ giữ key MỚI (chưa có trên sheet + chưa trùng
        // trong batch này), rồi map sang đúng thứ tự mergedHeader.
        const incomingKeyIdx = params.header.indexOf(params.keyColumn);
        const batchSeen = new Set<string>();
        const newRows: unknown[][] = [];
        for (const row of params.rows) {
          const k = String(row[incomingKeyIdx] ?? '').trim();
          if (!k || existingKeys.has(k) || batchSeen.has(k)) continue;
          batchSeen.add(k);
          newRows.push(
            mergedHeader.map((h) => {
              const i = params.header.indexOf(h);
              return i >= 0 ? normalizeCell(row[i]) : '';
            }),
          );
        }

        // Sheet chưa có header → ghi header trước (A1).
        if (!hasHeader) {
          await sheets.spreadsheets.values.update({
            spreadsheetId: params.spreadsheetId,
            range: `${params.title}!A1`,
            valueInputOption: 'RAW',
            requestBody: { values: [mergedHeader] },
          });
        }

        if (newRows.length === 0) {
          return {
            saUsed: pick.clientEmail,
            appended: 0,
            dataRowCount: dataRowCountBefore,
            sheetId,
          };
        }

        // 5) Vị trí ghi = ngay sau dòng cuối hiện có (header vừa ghi → row 2).
        const startRow = (hasHeader ? currentTotalRows : 1) + 1;
        const colCount = mergedHeader.length;
        const endCol = colLetter(colCount);
        const finalRow = startRow + newRows.length - 1;

        // 6) Mở rộng grid nếu thiếu (+1000 buffer).
        const needRows = finalRow + 1000;
        const needCols = Math.max(colCount, 26);
        if (gridRows < needRows || gridCols < needCols) {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: params.spreadsheetId,
            requestBody: {
              requests: [
                {
                  updateSheetProperties: {
                    properties: {
                      sheetId,
                      gridProperties: {
                        rowCount: Math.max(gridRows, needRows),
                        columnCount: Math.max(gridCols, needCols),
                      },
                    },
                    fields:
                      'gridProperties.rowCount,gridProperties.columnCount',
                  },
                },
              ],
            },
          });
        }

        // 7) Ghi phần MỚI xuống đáy theo chunk 1000 (throttle né rate limit).
        const CHUNK_SIZE = 1000;
        let rowCursor = startRow;
        for (let s = 0; s < newRows.length; s += CHUNK_SIZE) {
          const chunk = newRows.slice(s, s + CHUNK_SIZE);
          const endRow = rowCursor + chunk.length - 1;
          await sheets.spreadsheets.values.update({
            spreadsheetId: params.spreadsheetId,
            range: `${params.title}!A${rowCursor}:${endCol}${endRow}`,
            valueInputOption: 'RAW',
            requestBody: { values: chunk },
          });
          rowCursor = endRow + 1;
          if (s + CHUNK_SIZE < newRows.length) {
            await new Promise((r) => setTimeout(r, 200));
          }
        }

        this.logger.log(
          `[${params.title}] appended ${newRows.length} dòng mới ` +
            `(đã có ${existingKeys.size} key, bỏ qua ${params.rows.length - newRows.length})`,
        );

        return {
          saUsed: pick.clientEmail,
          appended: newRows.length,
          dataRowCount: dataRowCountBefore + newRows.length,
          sheetId,
        };
      }),
    );
  }

  /**
   * Apply format (header style, freeze, banding, autoResize) — gọi 1 lần
   * cuối job, sau khi xong streaming append.
   */
  async applyFormatAll(params: {
    spreadsheetId: string;
    sheets: Array<{
      title: string;
      sheetId: number;
      header: string[];
      dataRowCount: number;
      columnSpecs?: Record<string, ColumnSpec>;
    }>;
  }): Promise<void> {
    await this.withSheetLock(params.spreadsheetId, () =>
      this.rotator.withRotation(async (pick) => {
        const sheets = this.buildClient(pick);
        for (const w of params.sheets) {
          await this.applyFormat(
            sheets,
            params.spreadsheetId,
            w.sheetId,
            w.header,
            w.dataRowCount,
            w.columnSpecs,
          );
        }
      }),
    );
  }

  /**
   * Probe quyền truy cập tới spreadsheet bằng từng SA active. Trả về kết quả
   * per-SA để UI hiển thị danh sách SA cần share.
   */
  async testAccess(
    spreadsheetId: string,
    sas: Array<{ id: string; clientEmail: string; privateKey: string }>,
  ): Promise<
    Array<{
      saId: string;
      clientEmail: string;
      ok: boolean;
      error?: string;
    }>
  > {
    const out: Array<{
      saId: string;
      clientEmail: string;
      ok: boolean;
      error?: string;
    }> = [];
    for (const sa of sas) {
      try {
        const sheets = this.buildClient({
          ...sa,
          label: '',
          projectId: '',
          index: 0,
        });
        await sheets.spreadsheets.get({
          spreadsheetId,
          fields: 'spreadsheetId',
        });
        out.push({ saId: sa.id, clientEmail: sa.clientEmail, ok: true });
      } catch (err: unknown) {
        const msg =
          (err as { errors?: Array<{ message?: string }> }).errors?.[0]
            ?.message ??
          (err as Error).message ??
          'unknown';
        out.push({
          saId: sa.id,
          clientEmail: sa.clientEmail,
          ok: false,
          error: msg,
        });
      }
    }
    return out;
  }

  private async upsertOne(
    sheets: sheets_v4.Sheets,
    spreadsheetId: string,
    sheetId: number,
    w: WorksheetUpsert,
    opts: { skipFormat?: boolean } = {},
  ): Promise<number> {
    // Đọc data hiện tại
    const range = `${w.title}!A1:ZZ`;
    const current = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });
    const currentValues = (current.data.values ?? []) as string[][];
    const currentHeader =
      currentValues.length > 0 ? (currentValues[0] ?? []) : [];
    const currentRows = currentValues.length > 1 ? currentValues.slice(1) : [];

    // Union header (giữ thứ tự cũ trước, thêm cột mới ở cuối)
    const mergedHeader: string[] = [...currentHeader];
    for (const col of w.header) {
      if (!mergedHeader.includes(col)) mergedHeader.push(col);
    }

    // Index cột key trong header gộp
    const keyIdx = w.keyColumns.map((k) => mergedHeader.indexOf(k));
    if (keyIdx.some((i) => i < 0)) {
      throw new Error(
        `Key columns ${JSON.stringify(w.keyColumns)} không nằm trong header`,
      );
    }

    // Map các row hiện tại theo key
    const rowByKey = new Map<string, string[]>();
    for (const r of currentRows) {
      const padded = padRow(r, mergedHeader.length);
      const key = keyIdx.map((i) => String(padded[i] ?? '')).join('||');
      if (key.replace(/\|/g, '').length > 0) rowByKey.set(key, padded);
    }

    // Map data mới sang object (header cũ → ''), rồi merge theo key
    const newHeaderIdx = new Map<string, number>();
    w.header.forEach((h, i) => newHeaderIdx.set(h, i));

    for (const incoming of w.rows) {
      const obj: Record<string, unknown> = {};
      for (const h of w.header) {
        obj[h] = incoming[newHeaderIdx.get(h)!];
      }
      const key = w.keyColumns.map((k) => String(obj[k] ?? '')).join('||');
      if (key.replace(/\|/g, '').length === 0) continue;

      const existed = rowByKey.get(key);
      const merged = existed
        ? [...existed]
        : new Array(mergedHeader.length).fill('');
      for (const h of w.header) {
        const idx = mergedHeader.indexOf(h);
        merged[idx] = normalizeCell(obj[h]);
      }
      rowByKey.set(key, merged);
    }

    // Build matrix cuối cùng — clamp/pad mọi row về đúng mergedHeader.length
    // để bất biến: row.length === endCol width. Tránh "tried writing to column [P]".
    const finalRows: unknown[][] = [];
    for (const row of rowByKey.values()) {
      if (row.length === mergedHeader.length) finalRows.push(row);
      else if (row.length > mergedHeader.length)
        finalRows.push(row.slice(0, mergedHeader.length));
      else {
        const padded = [...row];
        while (padded.length < mergedHeader.length) padded.push('');
        finalRows.push(padded);
      }
    }

    // Ghi đè trực tiếp (KHÔNG clear toàn sheet trước). Lý do: upsert bọc trong
    // withRotation — nếu clear A1:ZZ trước rồi dính 429 giữa lúc ghi chunk, lần
    // retry sẽ đọc lại đúng sheet đã bị xoá + mới ghi dở → mất phần chưa kịp ghi
    // (đây là gốc của hiện tượng tụt từ 7000 xuống 500 dòng). Thay vào đó: ghi đè
    // finalRows từ A1 (cũ trùng key → đè/update, mới → ghi tiếp), rồi dọn phần
    // ĐUÔI dư SAU khi ghi xong. Cách này idempotent: retry chỉ ghi đè lại cùng
    // vùng, không có cửa sổ nào sheet bị trống.

    // Expand grid trước khi write (default 1000 rows × 26 cols, 254 creator
    // × 30 trend = ~7.6K rows → cần expand). +1000 buffer.
    const totalRowsNeeded = finalRows.length + 1; // +1 header
    const colCount = mergedHeader.length;
    const colCountSafe = Math.max(colCount, 26);
    {
      const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(sheetId,gridProperties))',
      });
      const sheetMeta = (meta.data.sheets ?? []).find(
        (s) => s.properties?.sheetId === sheetId,
      );
      const curRows = sheetMeta?.properties?.gridProperties?.rowCount ?? 1000;
      const curCols = sheetMeta?.properties?.gridProperties?.columnCount ?? 26;
      if (curRows < totalRowsNeeded + 1000 || curCols < colCountSafe) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                updateSheetProperties: {
                  properties: {
                    sheetId,
                    gridProperties: {
                      rowCount: Math.max(curRows, totalRowsNeeded + 1000),
                      columnCount: Math.max(curCols, colCountSafe),
                    },
                  },
                  fields: 'gridProperties.rowCount,gridProperties.columnCount',
                },
              },
            ],
          },
        });
      }
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${w.title}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [mergedHeader] },
    });

    const endColLetter = colLetter(colCount);
    const CHUNK_SIZE = 1000;
    for (let start = 0; start < finalRows.length; start += CHUNK_SIZE) {
      const chunk = finalRows.slice(start, start + CHUNK_SIZE);
      const startRow = start + 2; // +1 cho 0-index, +1 cho header
      const endRow = startRow + chunk.length - 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${w.title}!A${startRow}:${endColLetter}${endRow}`,
        valueInputOption: 'RAW',
        requestBody: { values: chunk },
      });
      this.logger.log(
        `[${w.title}] wrote chunk ${start + 1}-${start + chunk.length}/${finalRows.length}`,
      );
      // Throttle giữa chunks để tránh rate limit (Sheets ~60 write/min/user)
      if (start + CHUNK_SIZE < finalRows.length) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    // Dọn đuôi dư: chỉ khi data mới ÍT hơn data cũ (vd nhiều dòng cùng key gộp
    // lại). Chạy SAU khi ghi đủ finalRows nên không có cửa sổ mất data — nếu
    // bước này dính 429, retry đọc lại sẽ thấy đầy đủ finalRows + đuôi cũ, ghi đè
    // lại y nguyên rồi dọn đuôi tiếp (idempotent).
    if (currentRows.length > finalRows.length) {
      const firstStaleRow = finalRows.length + 2; // +1 header, +1 sang dòng đầu tiên dư
      await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `${w.title}!A${firstStaleRow}:ZZ`,
      });
    }

    // Format: header style, freeze, per-col number format, autoResize, banding.
    // Skip khi streaming (mỗi batch gọi nhiều lần) — caller sẽ format 1 lần cuối.
    if (!opts.skipFormat) {
      await this.applyFormat(
        sheets,
        spreadsheetId,
        sheetId,
        mergedHeader,
        finalRows.length,
        w.columnSpecs,
      );
    }

    this.logger.log(
      `Upserted "${w.title}" (${spreadsheetId}): ${finalRows.length} rows total`,
    );
    return finalRows.length;
  }

  /**
   * Áp formatting toàn sheet bằng 1 batchUpdate. Chia theo phase:
   *   1. Header: bg đậm, text trắng bold, center, freeze row 1
   *   2. Body: vmiddle alignment
   *   3. Per-column: horizontalAlignment + numberFormat theo type
   *   4. Borders thin grey toàn vùng có data
   *   5. AutoResize columns (Sheets sẽ fit content)
   *   6. Override pixelSize cho longText/url + WRAP để không tràn ngang
   *   7. Banding alternate (xoá cũ trước khi add mới — addBanding fail nếu trùng range)
   */
  private async applyFormat(
    sheets: sheets_v4.Sheets,
    spreadsheetId: string,
    sheetId: number,
    header: string[],
    dataRowCount: number,
    columnSpecs?: Record<string, ColumnSpec>,
  ): Promise<void> {
    if (header.length === 0) return;
    const totalRows = dataRowCount + 1; // +1 header
    const colCount = header.length;

    // Phase A: lấy danh sách bandedRange hiện có để xoá (addBanding fail nếu
    // trùng range) — Sheets không cho idempotent overwrite.
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      ranges: [],
      fields: 'sheets(properties(sheetId),bandedRanges(bandedRangeId,range))',
    });
    const targetSheet = (meta.data.sheets ?? []).find(
      (s) => s.properties?.sheetId === sheetId,
    );
    const existingBandIds: number[] = [];
    for (const b of targetSheet?.bandedRanges ?? []) {
      if (b.bandedRangeId != null) existingBandIds.push(b.bandedRangeId);
    }

    const requests: sheets_v4.Schema$Request[] = [];

    // 1. Freeze row 1
    requests.push({
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount',
      },
    });

    // 2. Header style (bg đậm, text trắng, bold, center, vmiddle, wrap, padding)
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: colCount,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: HEADER_BG,
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'WRAP',
            padding: { top: 6, bottom: 6, left: 8, right: 8 },
            textFormat: {
              foregroundColor: HEADER_FG,
              bold: true,
              fontSize: 11,
            },
          },
        },
        fields:
          'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,padding,textFormat)',
      },
    });

    // 3. Body row height (1 row = 24px) — set khi có data
    if (dataRowCount > 0) {
      requests.push({
        updateDimensionProperties: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: 1,
            endIndex: totalRows,
          },
          properties: { pixelSize: 24 },
          fields: 'pixelSize',
        },
      });
      // Header height to hơn (32px) cho dễ đọc
      requests.push({
        updateDimensionProperties: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: 0,
            endIndex: 1,
          },
          properties: { pixelSize: 32 },
          fields: 'pixelSize',
        },
      });
    }

    // 4. Body vmiddle + padding (toàn vùng data, sau đó override per-column)
    if (dataRowCount > 0) {
      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 1,
            endRowIndex: totalRows,
            startColumnIndex: 0,
            endColumnIndex: colCount,
          },
          cell: {
            userEnteredFormat: {
              verticalAlignment: 'MIDDLE',
              padding: { top: 4, bottom: 4, left: 8, right: 8 },
            },
          },
          fields: 'userEnteredFormat(verticalAlignment,padding)',
        },
      });
    }

    // 5. Per-column alignment + numberFormat + wrap
    if (columnSpecs && dataRowCount > 0) {
      header.forEach((colName, idx) => {
        const spec = columnSpecs[colName];
        if (!spec) return;
        const fmt = colFormat(spec.type);
        if (!fmt) return;
        requests.push({
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 1,
              endRowIndex: totalRows,
              startColumnIndex: idx,
              endColumnIndex: idx + 1,
            },
            cell: fmt.cell,
            fields: fmt.fields,
          },
        });
      });
    }

    // 6. Borders thin grey
    requests.push({
      updateBorders: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: totalRows,
          startColumnIndex: 0,
          endColumnIndex: colCount,
        },
        top: { style: 'SOLID', color: BORDER_GREY },
        bottom: { style: 'SOLID', color: BORDER_GREY },
        left: { style: 'SOLID', color: BORDER_GREY },
        right: { style: 'SOLID', color: BORDER_GREY },
        innerHorizontal: { style: 'SOLID', color: BORDER_GREY },
        innerVertical: { style: 'SOLID', color: BORDER_GREY },
      },
    });

    // 7. Auto-resize tất cả cột để fit content
    requests.push({
      autoResizeDimensions: {
        dimensions: {
          sheetId,
          dimension: 'COLUMNS',
          startIndex: 0,
          endIndex: colCount,
        },
      },
    });

    // 8. Override width cho cột longText/url để không quá rộng (auto-resize sẽ
    //    kéo dài theo nội dung dài nhất → tràn màn hình). Set fixed + WRAP.
    if (columnSpecs) {
      header.forEach((colName, idx) => {
        const spec = columnSpecs[colName];
        if (spec?.type === 'longText' || spec?.type === 'url') {
          requests.push({
            updateDimensionProperties: {
              range: {
                sheetId,
                dimension: 'COLUMNS',
                startIndex: idx,
                endIndex: idx + 1,
              },
              properties: { pixelSize: LONG_TEXT_WIDTH_PX },
              fields: 'pixelSize',
            },
          });
        }
      });
    }

    // 9. Xoá banding cũ + thêm banding mới (alternating zebra rows)
    for (const id of existingBandIds) {
      requests.push({ deleteBanding: { bandedRangeId: id } });
    }
    requests.push({
      addBanding: {
        bandedRange: {
          range: {
            sheetId,
            startRowIndex: 0,
            endRowIndex: totalRows,
            startColumnIndex: 0,
            endColumnIndex: colCount,
          },
          rowProperties: {
            headerColor: HEADER_BG,
            firstBandColor: BAND_FIRST,
            secondBandColor: BAND_SECOND,
          },
        },
      },
    });

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
  }
}

function padRow(row: string[], len: number): string[] {
  if (row.length === len) return row;
  if (row.length > len) return row.slice(0, len);
  const padded = [...row];
  while (padded.length < len) padded.push('');
  return padded;
}

/** Convert column index (1-based) → letter: 1→A, 26→Z, 27→AA, 52→AZ, 53→BA */
function colLetter(idx: number): string {
  if (idx <= 0) return 'A';
  let n = idx;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function normalizeCell(v: unknown): string | number | boolean {
  if (v == null) return '';
  if (
    typeof v === 'string' ||
    typeof v === 'number' ||
    typeof v === 'boolean'
  ) {
    return v;
  }
  return JSON.stringify(v);
}

/**
 * Trả về `{cell, fields}` cho repeatCell theo column type. null = skip
 * (không cần override vì body đã có vmiddle + padding mặc định).
 */
function colFormat(type: ColumnType): {
  cell: { userEnteredFormat: sheets_v4.Schema$CellFormat };
  fields: string;
} | null {
  switch (type) {
    case 'integer':
      return {
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'RIGHT',
            numberFormat: { type: 'NUMBER', pattern: '#,##0' },
          },
        },
        fields: 'userEnteredFormat(horizontalAlignment,numberFormat)',
      };
    case 'number':
      return {
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'RIGHT',
            numberFormat: { type: 'NUMBER', pattern: '#,##0.00' },
          },
        },
        fields: 'userEnteredFormat(horizontalAlignment,numberFormat)',
      };
    case 'currency':
      return {
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'RIGHT',
            numberFormat: { type: 'NUMBER', pattern: '#,##0 "₫"' },
          },
        },
        fields: 'userEnteredFormat(horizontalAlignment,numberFormat)',
      };
    case 'date':
      return {
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'CENTER',
          },
        },
        fields: 'userEnteredFormat.horizontalAlignment',
      };
    case 'longText':
      return {
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'LEFT',
            wrapStrategy: 'WRAP',
          },
        },
        fields: 'userEnteredFormat(horizontalAlignment,wrapStrategy)',
      };
    case 'url':
      return {
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'LEFT',
            wrapStrategy: 'CLIP',
            textFormat: {
              foregroundColor: {
                red: 0x10 / 255,
                green: 0x6e / 255,
                blue: 0xbe / 255,
              },
              underline: true,
            },
          },
        },
        fields:
          'userEnteredFormat(horizontalAlignment,wrapStrategy,textFormat)',
      };
    case 'text':
    default:
      return {
        cell: {
          userEnteredFormat: { horizontalAlignment: 'LEFT' },
        },
        fields: 'userEnteredFormat.horizontalAlignment',
      };
  }
}
