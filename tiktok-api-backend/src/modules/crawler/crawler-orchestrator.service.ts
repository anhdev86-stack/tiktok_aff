/**
 * CrawlerOrchestratorService — manages a Map<groupId, GroupWorker>.
 *
 * Lifecycle:
 *   - OnModuleInit: auto-start all groups với enabled=true; cảnh báo group
 *     enabled=false mà có account (hint cho admin: phải bấm Start).
 *   - OnModuleDestroy: graceful drain (30s).
 *   - Periodic reconcile (30s): tự bắt nhịp DB <-> worker map, không cần
 *     gọi orchestrator từ CrawlerGroupService (tránh forwardRef circular dep):
 *       a. Group enabled=true mà chưa có worker đang chạy → spawn.
 *       b. Group đã xoá khỏi DB mà worker còn trong map → cleanup entry.
 *       c. Worker còn map nhưng group enabled=false → stop entry (best-effort).
 */
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { CrawlerGroupService } from '../crawler-group/crawler-group.service';
import { TiktokAccountService } from '../tiktok-account/tiktok-account.service';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { CrawlerRunOneAccount } from './crawler.run-one-account';
import { GroupWorker } from './group-worker';

const RECONCILE_INTERVAL_MS = 30_000;

@Injectable()
export class CrawlerOrchestratorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(CrawlerOrchestratorService.name);
  private readonly workers = new Map<string, GroupWorker>();
  private reconcileTimer?: NodeJS.Timeout;

  constructor(
    private readonly groups: CrawlerGroupService,
    private readonly accounts: TiktokAccountService,
    private readonly settings: AppSettingsService,
    private readonly runner: CrawlerRunOneAccount,
  ) {}

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    const allGroups = await this.groups.findAll();
    const enabled = allGroups.filter((g) => g.enabled);

    for (const g of enabled) {
      await this.startGroup(String(g._id));
    }
    this.logger.log(`Auto-started ${enabled.length} groups`);

    // Cảnh báo group disabled nhưng có account — hint admin phải bấm Start.
    const disabled = allGroups.filter((g) => !g.enabled);
    for (const g of disabled) {
      const cnt = await this.accounts.countByGroup(String(g._id));
      if (cnt > 0) {
        this.logger.warn(
          `Group "${g.name}" (id=${String(g._id)}) có ${cnt} account ` +
            `nhưng enabled=false — bấm Start trong UI nếu muốn crawl.`,
        );
      }
    }

    // Khởi động reconcile loop. unref để Node thoát sạch khi shutdown.
    this.reconcileTimer = setInterval(() => {
      void this.reconcile();
    }, RECONCILE_INTERVAL_MS);
    this.reconcileTimer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.logger.log('Stopping all workers (graceful 30s)');
    await Promise.all([...this.workers.values()].map((w) => w.stop(30_000)));
  }

  /**
   * Reconcile workers map với state DB. Idempotent — chỉ tác động khi lệch.
   * Chạy mỗi 30s. Sai lệch tối đa = 30s sau khi user enable/delete group.
   */
  private async reconcile(): Promise<void> {
    try {
      const allGroups = await this.groups.findAll();
      const dbIds = new Set(allGroups.map((g) => String(g._id)));

      // (a) Group enabled trong DB mà worker chưa alive → spawn.
      for (const g of allGroups) {
        if (!g.enabled) continue;
        const id = String(g._id);
        if (!this.workers.get(id)?.isAlive()) {
          this.logger.log(
            `Reconcile: auto-spawn worker cho group "${g.name}" (id=${id})`,
          );
          await this.startGroup(id);
        }
      }

      // (b) Worker đang quản nhưng group đã xoá khỏi DB → cleanup map entry.
      for (const [id, w] of this.workers) {
        if (!dbIds.has(id)) {
          this.logger.log(
            `Reconcile: group ${id} đã xoá — dọn worker khỏi map`,
          );
          // Worker tự exit qua findById throw NotFound (đã có logic).
          await w.stop(5_000).catch(() => undefined);
          this.workers.delete(id);
        }
      }

      // (c) Group enabled=false trong DB nhưng worker còn alive (vd enabled bị
      // tắt trực tiếp ngoài luồng stopGroup) → stop để khớp DB. stop() idempotent.
      for (const g of allGroups) {
        if (g.enabled) continue;
        const id = String(g._id);
        const w = this.workers.get(id);
        if (w?.isAlive()) {
          this.logger.log(
            `Reconcile: group "${g.name}" (id=${id}) enabled=false nhưng worker còn chạy → stop`,
          );
          await w.stop(5_000).catch(() => undefined);
        }
      }
    } catch (err) {
      this.logger.error(
        'Reconcile loop failed',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /** Start worker for a group. Creates worker if not yet in map. Idempotent. */
  async startGroup(id: string): Promise<{ ok: true; running: boolean }> {
    let w = this.workers.get(id);
    if (!w) {
      w = new GroupWorker(
        id,
        this.groups,
        this.accounts,
        this.settings,
        this.runner,
      );
      this.workers.set(id, w);
    }
    await w.start();
    return { ok: true, running: w.isAlive() };
  }

  /**
   * Stop worker for a group.
   * Sets enabled=false in DB even when no worker exists in map
   * to guarantee consistent DB state (e.g. after a server restart).
   */
  async stopGroup(id: string): Promise<{ ok: true; running: boolean }> {
    const w = this.workers.get(id);
    if (w) {
      await w.stop(30_000);
    } else {
      // Worker không trong memory (sau restart enabled=false, hoặc status DB kẹt
      // 'running' do worker cũ chết đột ngột — SIGKILL/OOM không chạy finally).
      // setEnabled=false + reset status về 'idle' để FE không kẹt "Đang chạy" giả.
      await this.groups.setEnabled(id, false);
      await this.groups.updateStatus(id, {
        status: 'idle',
        currentAccountId: null,
      });
    }
    return { ok: true, running: this.workers.get(id)?.isAlive() ?? false };
  }

  /** Get status for one group: DB doc + live running flag. */
  async getGroupStatus(id: string): Promise<Record<string, unknown>> {
    const group = await this.groups.findById(id);
    return {
      ...group.toObject(),
      running: this.workers.get(id)?.isAlive() ?? false,
    };
  }

  /** Get status for all groups: array of DB docs + live running flag each. */
  async getAllStatus(): Promise<Record<string, unknown>[]> {
    const allGroups = await this.groups.findAll();
    return allGroups.map((g) => ({
      ...g.toObject(),
      running: this.workers.get(String(g._id))?.isAlive() ?? false,
    }));
  }

  /**
   * Diagnose 1 group — trả nguyên nhân vì sao worker không crawl.
   * Dùng cho UI khi user thấy worker idle/sleeping mãi.
   * Không thay đổi state — chỉ đọc.
   */
  async diagnoseGroup(id: string): Promise<{
    groupId: string;
    name: string;
    enabled: boolean;
    workerAlive: boolean;
    spreadsheetIdConfigured: boolean;
    accountsTotal: number;
    accountsActive: number;
    accountsCookieDead: number;
    accountsInactive: number;
    suggestion: string;
  }> {
    const group = await this.groups.findById(id);
    const allAccounts = await this.accounts.findByGroup(id);
    const active = allAccounts.filter(
      (a) => a.active !== false && a.cookieAlive !== false,
    ).length;
    const cookieDead = allAccounts.filter(
      (a) => a.active !== false && a.cookieAlive === false,
    ).length;
    const inactive = allAccounts.filter((a) => a.active === false).length;
    const workerAlive = this.workers.get(id)?.isAlive() ?? false;
    const spreadsheetIdConfigured = Boolean(group.spreadsheetId);

    let suggestion: string;
    if (!group.enabled) {
      suggestion = 'Group đang disabled — bấm Start trong UI để worker chạy.';
    } else if (!spreadsheetIdConfigured) {
      suggestion =
        'Chưa cấu hình spreadsheetId — vào Edit group, dán Spreadsheet ID.';
    } else if (allAccounts.length === 0) {
      suggestion =
        'Group có 0 account — vào trang Accounts, gán ít nhất 1 account vào group này.';
    } else if (active === 0) {
      suggestion =
        cookieDead > 0
          ? `Tất cả ${allAccounts.length} account đều cookie chết hoặc inactive — vào Accounts, cập nhật cookie hoặc bật active.`
          : `Tất cả ${allAccounts.length} account đều inactive — bật active trong Accounts.`;
    } else if (!workerAlive) {
      suggestion =
        'Worker chưa chạy dù đủ điều kiện — reconcile sẽ tự spawn ≤30s, hoặc bấm Start.';
    } else {
      suggestion = 'OK — worker đang chạy với đủ điều kiện.';
    }

    return {
      groupId: String(group._id),
      name: group.name,
      enabled: group.enabled,
      workerAlive,
      spreadsheetIdConfigured,
      accountsTotal: allAccounts.length,
      accountsActive: active,
      accountsCookieDead: cookieDead,
      accountsInactive: inactive,
      suggestion,
    };
  }
}
