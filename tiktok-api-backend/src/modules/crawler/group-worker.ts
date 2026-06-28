/**
 * GroupWorker — in-process loop worker for one CrawlerGroup.
 * Plain class (not @Injectable). One instance per group managed by CrawlerOrchestratorService.
 *
 * Concurrency guards (ported from CrawlerService):
 *   H1 — `starting` guard prevents dual-loop from concurrent start() calls.
 *   H2 — `running` flag set synchronously before any await in start().
 *   H3 — stop() awaits currentLoop drain (timeoutMs); isAlive() reflects loop-alive state.
 *   TOCTOU — re-reads group + settings per account to pick up runtime config changes.
 */
import { Logger } from '@nestjs/common';
import { type Types } from 'mongoose';
import type { CrawlerGroupService } from '../crawler-group/crawler-group.service';
import type { TiktokAccountService } from '../tiktok-account/tiktok-account.service';
import type { AppSettingsService } from '../app-settings/app-settings.service';
import type { TiktokAccountDocument } from '../tiktok-account/schemas/tiktok-account.schema';
import type { CrawlerGroupDocument } from '../crawler-group/schemas/crawler-group.schema';
import { TiktokSearchAuthError } from '../tiktok-client/tiktok-client.service';
import type { CrawlerRunOneAccount } from './crawler.run-one-account';

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Truncate string to maxLen chars for DB storage. */
function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

/** Minimum sleep when no active accounts or delayBetweenLoopsMs=0. */
const MIN_EMPTY_SLEEP_MS = 5_000;

export class GroupWorker {
  private readonly logger: Logger;

  /** Desire flag — true means loop should keep running. */
  private running = false;

  /** Guard preventing concurrent start() calls from spawning 2 loops (H1). */
  private starting = false;

  /** Reference to loop promise for graceful drain (H3). */
  private currentLoop?: Promise<void>;

  /**
   * Đánh thức sleep đang chờ (đặt bởi interruptibleSleep). stop() gọi để loop
   * thoát sleep giữa vòng/giữa account NGAY thay vì đợi hết delay (có thể nhiều
   * phút) mới check `running` — nếu không status kẹt ở 'stopping'.
   */
  private wakeStop: (() => void) | null = null;

  constructor(
    private readonly groupId: string,
    private readonly groupService: CrawlerGroupService,
    private readonly accountService: TiktokAccountService,
    private readonly settings: AppSettingsService,
    private readonly runner: CrawlerRunOneAccount,
  ) {
    this.logger = new Logger(`GroupWorker[${groupId}]`);
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Idempotent start: sets enabled=true in DB, fires loop if not already running.
   * H1/H2: `running` is set synchronously before any await; `starting` guards
   * concurrent calls from slipping through the check→set gap.
   */
  async start(): Promise<void> {
    if (this.starting || this.running) {
      this.logger.log('start() called but loop already running — no-op');
      return;
    }

    this.starting = true;
    try {
      // Loop trước có thể còn đang drain (stop() trả về do timeout khi 1 account
      // chạy lâu). Chờ nó thoát hẳn trước khi spawn loop mới — nếu không, loop cũ
      // re-read running=true rồi resume → 2 loop song song. Với cancellation token
      // thì drain rất nhanh nên await này ngắn.
      if (this.currentLoop) {
        this.logger.log('start() chờ loop cũ drain xong trước khi spawn mới');
        await this.currentLoop.catch(() => undefined);
      }
      if (this.running) return; // double-check after guard acquired

      this.running = true;
      await this.groupService.setEnabled(this.groupId, true);
      await this.groupService.updateStatus(this.groupId, { status: 'running' });

      this.currentLoop = this.loop().finally(() => {
        this.currentLoop = undefined;
      });
    } finally {
      this.starting = false;
    }
  }

  /**
   * Signal loop to stop. Awaits drain up to timeoutMs (H3).
   * Sets enabled=false in DB so loop re-reads and exits naturally.
   */
  async stop(timeoutMs = 30_000): Promise<void> {
    // Set cờ TRƯỚC, không phụ thuộc DB. Nếu setEnabled throw (Mongo timeout) mà
    // running vẫn true → loop chạy mãi, bấm Stop vô tác dụng. running=false ở đây
    // mới là thứ thực sự khiến loop + cancellation token dừng.
    this.running = false;
    this.wakeStop?.(); // thoát mọi sleep đang chờ → loop check running ngay
    try {
      await this.groupService.setEnabled(this.groupId, false);
      await this.groupService.updateStatus(this.groupId, { status: 'stopping' });
    } catch (err) {
      this.logger.error(
        `stop(): cập nhật DB lỗi nhưng vẫn dừng loop — ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    if (this.currentLoop) {
      await Promise.race([this.currentLoop, sleep(timeoutMs)]);
    }
  }

  /**
   * True while loop goroutine is alive (H3: reflects actual state, not desire flag).
   * Stays true during drain after stop() — FE shows accurate status during shutdown.
   */
  isAlive(): boolean {
    return this.currentLoop !== undefined;
  }

  // ─── Private loop ────────────────────────────────────────────────────────

  /**
   * Sleep nhưng thoát sớm khi stop() gọi wakeStop. Dùng cho mọi delay trong loop
   * để bấm Stop có hiệu lực ngay, không phải đợi hết delayBetweenLoops/Accounts.
   */
  private interruptibleSleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.wakeStop = null;
        resolve();
      }, ms);
      this.wakeStop = () => {
        clearTimeout(timer);
        this.wakeStop = null;
        resolve();
      };
    });
  }

  private async loop(): Promise<void> {
    // First-iteration banner: in tên group + spreadsheetId để debug được ngay
    // group nào đang chạy, không phải dò id qua mongo shell.
    try {
      const initialGroup = await this.safeGetGroup();
      if (initialGroup) {
        const totalAccs = await this.accountService
          .findByGroup(this.groupId)
          .then((a) => a.length)
          .catch(() => -1);
        this.logger.log(
          `Loop started — group="${initialGroup.name}" ` +
            `spreadsheetId=${initialGroup.spreadsheetId || '(empty)'} ` +
            `accountsInGroup=${totalAccs}`,
        );
      } else {
        this.logger.log('Loop started (group not found — will exit)');
      }
    } catch {
      this.logger.log('Loop started');
    }

    try {
      while (this.running) {
        // TOCTOU: re-read group at top of every iteration
        const group = await this.safeGetGroup();
        if (!group || !group.enabled) {
          this.running = false;
          break;
        }

        if (!group.spreadsheetId) {
          await this.groupService.updateStatus(this.groupId, {
            status: 'sleeping',
            lastError: 'spreadsheetId chưa cấu hình',
          });
          this.logger.warn('spreadsheetId not configured — sleeping');
          const s = await this.settings.get();
          await this.interruptibleSleep(
            s.delayBetweenLoopsMs > 0
              ? s.delayBetweenLoopsMs
              : MIN_EMPTY_SLEEP_MS,
          );
          continue;
        }

        const allAccounts = await this.accountService.findByGroup(this.groupId);
        const active = allAccounts.filter(
          (a) => a.active !== false && a.cookieAlive !== false,
        );

        if (active.length === 0) {
          let detail: string;
          if (allAccounts.length === 0) {
            detail =
              `group "${group.name}" (id=${this.groupId}) có 0 account — ` +
              `vào UI → Crawler Groups → group này → gán account vào nhóm`;
          } else {
            const inactiveCount = allAccounts.filter(
              (a) => a.active === false,
            ).length;
            const deadCookieCount = allAccounts.filter(
              (a) => a.active !== false && a.cookieAlive === false,
            ).length;
            detail =
              `group "${group.name}" có ${allAccounts.length} account` +
              (inactiveCount > 0 ? `, ${inactiveCount} inactive` : '') +
              (deadCookieCount > 0
                ? `, ${deadCookieCount} cookie chết (cần cập nhật cookie)`
                : '');
          }
          this.logger.warn(
            `No active accounts with alive cookies — sleeping (${detail})`,
          );
          // Cập nhật status để FE không hiển thị "Đang chạy" giả khi worker thực
          // ra đang nghỉ vì 0 account sống (đây là gốc của hiển thị "10 ngày
          // trước" + 'running' mâu thuẫn trên dashboard).
          await this.groupService.updateStatus(this.groupId, {
            status: 'sleeping',
            currentAccountId: null,
            lastError: detail,
          });
          const s = await this.settings.get();
          await this.interruptibleSleep(
            s.delayBetweenLoopsMs > 0
              ? s.delayBetweenLoopsMs
              : MIN_EMPTY_SLEEP_MS,
          );
          continue;
        }

        await this.groupService.updateStatus(this.groupId, {
          lastLoopStartedAt: new Date(),
          lastError: '', // clear lỗi vòng trước khi bắt đầu vòng mới
        });

        await this.runAccounts(active);

        // End of round
        await this.groupService.incrementLoopCount(this.groupId);
        await this.groupService.updateStatus(this.groupId, {
          status: 'sleeping', // chờ delayBetweenLoopsMs trước vòng kế
          lastLoopFinishedAt: new Date(),
          currentAccountId: null,
        });

        if (!this.running) break;

        const s2 = await this.settings.get();
        if (s2.delayBetweenLoopsMs > 0) {
          await this.interruptibleSleep(s2.delayBetweenLoopsMs);
        }
      }
    } finally {
      await this.groupService.updateStatus(this.groupId, {
        status: 'idle',
        currentAccountId: null,
      });
      this.running = false;
      this.logger.log('Loop stopped');
    }
  }

  /** Iterate accounts; re-reads group+settings per account (TOCTOU guard). */
  private async runAccounts(active: TiktokAccountDocument[]): Promise<void> {
    for (const acc of active) {
      if (!this.running) break;

      // Re-read group per account to pick up runtime config changes (TOCTOU)
      const group = await this.safeGetGroup();
      if (!group || !group.enabled) {
        this.running = false;
        break;
      }

      // Re-read global settings for delays
      const s = await this.settings.get();

      await this.groupService.updateStatus(this.groupId, {
        currentAccountId: acc._id as unknown as Types.ObjectId,
        status: 'running',
      });

      try {
        await this.runner.runOneAccount(acc, group, () => !this.running);
      } catch (err) {
        await this.handleAccountError(acc, err);
      }

      await this.groupService.updateStatus(this.groupId, {
        status: 'sleeping',
      });

      if (s.delayBetweenAccountsMs > 0) {
        await this.interruptibleSleep(s.delayBetweenAccountsMs);
      }
    }
  }

  /**
   * Get group by id; returns null (instead of throwing) so the loop can exit gracefully
   * when the group is deleted at runtime.
   */
  private async safeGetGroup(): Promise<CrawlerGroupDocument | null> {
    try {
      return await this.groupService.findById(this.groupId);
    } catch (err) {
      this.logger.error(
        `[${this.groupId}] Failed to fetch group — stopping worker`,
        err instanceof Error ? err.stack : String(err),
      );
      return null;
    }
  }

  private async handleAccountError(
    acc: TiktokAccountDocument,
    err: unknown,
  ): Promise<void> {
    if (err instanceof TiktokSearchAuthError) {
      await this.accountService.markCookieDead(String(acc._id), err.message);
      const msg = truncate(`[${acc.name}] cookie chết: ${err.message}`, 1000);
      await this.groupService.updateStatus(this.groupId, { lastError: msg });
      this.logger.warn(msg);
    } else {
      const raw = err instanceof Error ? err.message : String(err);
      const msg = truncate(`[${acc.name}] ${raw}`, 1000);
      await this.groupService.updateStatus(this.groupId, { lastError: msg });
      this.logger.error(
        `Acc ${acc.name} error: ${raw}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}
