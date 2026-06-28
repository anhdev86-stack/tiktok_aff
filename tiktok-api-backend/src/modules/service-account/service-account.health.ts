import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

/** Kết quả health-check 1 Service Account. */
export interface SaHealthResult {
  saId: string;
  clientEmail: string;
  active: boolean;
  /** Mint được OAuth token (credential/key còn hợp lệ, project chưa xoá). */
  credentialsOk: boolean;
  /**
   * Có quyền đọc spreadsheet được hỏi. `null` = không probe (không truyền
   * spreadsheetId), `false` = chưa share / sheet không tồn tại.
   */
  sheetAccessOk: boolean | null;
  /** Mô tả lỗi gần nhất (credential hoặc sheet) cho UI. */
  error?: string;
}

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

interface SaInput {
  id: string;
  clientEmail: string;
  privateKey: string;
  active: boolean;
}

/**
 * Probe 1 SA: trước hết mint token (credential hợp lệ?), sau đó — nếu có
 * spreadsheetId — thử đọc metadata sheet (đã được share quyền?).
 *
 * KHÔNG ném: mọi lỗi gói vào result để caller probe cả pool song song mà
 * 1 SA hỏng không kéo đổ các SA khác.
 */
export async function probeServiceAccount(
  sa: SaInput,
  spreadsheetId?: string,
): Promise<SaHealthResult> {
  const base: SaHealthResult = {
    saId: sa.id,
    clientEmail: sa.clientEmail,
    active: sa.active,
    credentialsOk: false,
    sheetAccessOk: null,
  };

  const client = new JWT({
    email: sa.clientEmail,
    key: sa.privateKey,
    scopes: SCOPES,
  });

  // Tầng 1: credential. authorize() gọi oauth2/v4/token — fail = SA bị disable,
  // key sai/thu hồi, hoặc clock skew. Đây là tín hiệu "SA chết" thật sự.
  try {
    await client.authorize();
    base.credentialsOk = true;
  } catch (err) {
    base.error = `credential: ${readError(err)}`;
    return base;
  }

  // Tầng 2: quyền sheet (chỉ khi có spreadsheetId). 403 = chưa share, 404 =
  // sheet không tồn tại / SA không thấy được.
  if (spreadsheetId) {
    try {
      const sheets = google.sheets({ version: 'v4', auth: client });
      await sheets.spreadsheets.get({ spreadsheetId, fields: 'spreadsheetId' });
      base.sheetAccessOk = true;
    } catch (err) {
      base.sheetAccessOk = false;
      base.error = `sheet: ${readError(err)}`;
    }
  }

  return base;
}

/** Rút message gọn từ lỗi gaxios/oauth (nhiều hình dạng) cho UI đọc. */
function readError(err: unknown): string {
  if (!err || typeof err !== 'object') return String(err);
  const e = err as {
    response?: {
      data?: {
        error?: string | { message?: string };
        error_description?: string;
      };
    };
    errors?: Array<{ message?: string }>;
    message?: string;
  };
  // OAuth token endpoint: { error: 'invalid_grant', error_description: '...' }
  const data = e.response?.data;
  if (data) {
    const code = typeof data.error === 'string' ? data.error : undefined;
    const desc =
      data.error_description ??
      (typeof data.error === 'object' ? data.error?.message : undefined);
    if (code || desc) return [code, desc].filter(Boolean).join(': ');
  }
  // Sheets API: { errors: [{ message }] }
  if (e.errors?.[0]?.message) return e.errors[0].message;
  return e.message ?? 'unknown error';
}
