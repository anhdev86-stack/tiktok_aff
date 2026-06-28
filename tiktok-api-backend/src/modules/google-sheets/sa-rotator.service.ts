import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import {
  ServiceAccountService,
  type DecryptedServiceAccount,
} from '../service-account/service-account.service';

export interface SaPick extends DecryptedServiceAccount {
  /** Index trong pool tại lần pick này (debug) */
  index: number;
}

/**
 * Round-robin SA pool đọc từ DB. Mỗi lần `pick` query lại các SA active +
 * không trong cooldown, đảm bảo tôn trọng admin toggle real-time.
 */
@Injectable()
export class SaRotatorService {
  private readonly logger = new Logger(SaRotatorService.name);
  private cursor = 0;

  constructor(private readonly accounts: ServiceAccountService) {}

  async pick(): Promise<SaPick> {
    const pool = await this.accounts.findActiveDecrypted();
    if (!pool.length) {
      throw new InternalServerErrorException(
        'Không có Service Account nào khả dụng. Thêm SA tại trang config trước.',
      );
    }
    const idx = this.cursor % pool.length;
    this.cursor = (this.cursor + 1) % pool.length;
    const picked = pool[idx];
    return { ...picked, index: idx };
  }

  async markRateLimited(id: string, durationMs = 60_000): Promise<void> {
    await this.accounts.markRateLimited(id, durationMs);
    this.logger.warn(`SA ${id} cooldown ${durationMs}ms`);
  }

  /**
   * Wrap callback có thể fail tạm thời. Tự động retry với phân loại lỗi:
   *   - 429 (rate limit): mark SA đang dùng cooldown → xoay sang SA khác.
   *   - 5xx / lỗi mạng (ECONNRESET, ETIMEDOUT, socket hang up...): lỗi phía
   *     Google hoặc đường truyền, KHÔNG phải lỗi SA → không cooldown, vẫn xoay
   *     SA + backoff (lần thử mới có thể đi đường khác / qua cơn unavailable).
   *   - Lỗi khác (4xx non-429: 400 bad request, 403 permission...): fatal,
   *     throw ngay vì retry vô nghĩa.
   *
   * Giữa các lần thử có exponential backoff + jitter (cap 30s) theo khuyến nghị
   * của Google, tránh đập liên tục vào limit ở mức project.
   *
   * IDEMPOTENCY: callback PHẢI an toàn khi chạy lại. upsertOne đã thiết kế
   * write-then-clear-tail nên retry không gây mất data.
   */
  async withRotation<T>(
    fn: (pick: SaPick) => Promise<T>,
    maxRetriesOverride?: number,
  ): Promise<T> {
    const initialPool = await this.accounts.findActiveDecrypted();
    // Cho phép thử rộng hơn số SA để còn chỗ backoff khi gặp chuỗi 5xx/network
    // thoáng qua (transient không tiêu hao SA như 429).
    //
    // Floor=8: cooldown 429 là 60s. Backoff (cap 30s) cộng dồn qua các attempt
    // = 1+2+4+8+16+30+30 ≈ 91s > 60s, nên khi TẤT CẢ SA cùng dính 429 vẫn còn
    // lượt để chờ SA hồi phục rồi pick lại — thay vì exhaust ở ~31s (6 attempt).
    const maxRetries =
      maxRetriesOverride ?? Math.max(8, initialPool.length * 2);
    let lastErr: unknown;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // Backoff trước mỗi lần thử lại (attempt > 0). Lần đầu chạy ngay.
      if (attempt > 0) await sleep(computeBackoffMs(attempt));

      let pick: SaPick;
      try {
        pick = await this.pick();
      } catch (pickErr) {
        // Pool rỗng (mọi SA đang cooldown). Còn lượt → vòng sau backoff rồi thử
        // pick lại (cooldown có thể hết). Hết lượt → throw lỗi gần nhất.
        lastErr = lastErr ?? pickErr;
        continue;
      }

      try {
        const r = await fn(pick);
        await this.accounts.markUsed(pick.id);
        return r;
      } catch (err: unknown) {
        lastErr = err;
        if (isRateLimitError(err)) {
          await this.markRateLimited(pick.id);
          this.logger.warn(
            `SA ${pick.clientEmail} dính 429 (attempt ${attempt + 1}/${maxRetries}) — xoay SA + backoff`,
          );
          continue;
        }
        if (isTransientError(err)) {
          this.logger.warn(
            `Lỗi tạm thời [${describeErr(err)}] (attempt ${attempt + 1}/${maxRetries}) — backoff + retry`,
          );
          continue;
        }
        // Lỗi không hồi phục được → fail nhanh.
        throw err;
      }
    }

    throw lastErr instanceof Error
      ? lastErr
      : new InternalServerErrorException('SA rotation exhausted');
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Exponential backoff + jitter, cap 30s. `attempt` tính từ 1. */
function computeBackoffMs(attempt: number): number {
  const base = 1_000;
  const cap = 30_000;
  const exp = Math.min(cap, base * 2 ** (attempt - 1));
  const jitter = Math.floor(Math.random() * 250);
  return exp + jitter;
}

/** Rút HTTP status từ nhiều hình dạng lỗi (gaxios / googleapis / fetch). */
function statusOf(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as {
    code?: number | string;
    status?: number;
    response?: { status?: number };
  };
  if (typeof e.response?.status === 'number') return e.response.status;
  if (typeof e.status === 'number') return e.status;
  if (typeof e.code === 'number') return e.code;
  return undefined;
}

function isRateLimitError(err: unknown): boolean {
  return statusOf(err) === 429;
}

/** 5xx hoặc lỗi mạng tạm thời → đáng retry. */
function isTransientError(err: unknown): boolean {
  const status = statusOf(err);
  if (status != null && status >= 500 && status <= 599) return true;
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: number | string }).code;
  if (typeof code === 'string') {
    const NET = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ECONNREFUSED',
      'EAI_AGAIN',
      'EPIPE',
      'ENOTFOUND',
      'ECONNABORTED',
      // Stream đóng sớm trước khi nhận đủ body — gặp ở fetch oauth2/v4/token
      // (gaxios báo "Premature close"). Connection blip transient như ECONNRESET.
      'ERR_STREAM_PREMATURE_CLOSE',
    ];
    if (NET.includes(code)) return true;
  }
  const msg = (err as { message?: string }).message ?? '';
  return /socket hang up|network timeout|timeout of \d+ms exceeded|premature close/i.test(
    msg,
  );
}

/** Mô tả ngắn lỗi cho log (status + code + message). */
function describeErr(err: unknown): string {
  if (!err || typeof err !== 'object') return String(err);
  const status = statusOf(err);
  const code = (err as { code?: unknown }).code;
  const msg = (err as { message?: string }).message;
  return [
    status != null && `status=${status}`,
    code != null && `code=${String(code)}`,
    msg,
  ]
    .filter(Boolean)
    .join(' ');
}
