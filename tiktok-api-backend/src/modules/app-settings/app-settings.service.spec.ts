import { Test, type TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { AppSettingsService } from './app-settings.service';
import { AppSettings } from './schemas/app-settings.schema';
import { GoogleSheetsService } from '../google-sheets/google-sheets.service';
import { ServiceAccountService } from '../service-account/service-account.service';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDefaultDoc(overrides: Record<string, unknown> = {}) {
  return {
    key: 'singleton',
    spreadsheetId: '',
    sheetOverview: 'Tổng quan',
    sheetTopVideos: 'Video nổi bật',
    sheetTrend: 'Xu hướng',
    crawlerEnabled: false,
    categoryList: [],
    delayBetweenAccountsMs: 0,
    delayBetweenLoopsMs: 0,
    crawlerStatus: 'idle',
    lastLoopStartedAt: null,
    lastLoopFinishedAt: null,
    currentAccountId: null,
    loopCount: 0,
    lastError: '',
    ...overrides,
  };
}

// ─── Model mock factory ───────────────────────────────────────────────────────

function buildModelMock(stored: Record<string, unknown> | null = null) {
  let store: Record<string, unknown> | null = stored;

  const execFn = jest
    .fn()
    .mockImplementation(() => Promise.resolve(store ?? makeDefaultDoc()));

  const findOneAndUpdateMock = jest.fn().mockReturnValue({ exec: execFn });

  return {
    findOneAndUpdate: findOneAndUpdateMock,
    _setStore: (v: Record<string, unknown> | null) => {
      store = v;
    },
    _execFn: execFn,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AppSettingsService', () => {
  let service: AppSettingsService;
  let modelMock: ReturnType<typeof buildModelMock>;

  const mockSheetsService = {
    testAccess: jest.fn(),
  };

  const mockSaService = {
    findActiveDecrypted: jest.fn(),
  };

  async function createModule(
    stored: Record<string, unknown> | null = null,
  ): Promise<void> {
    modelMock = buildModelMock(stored);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppSettingsService,
        {
          provide: getModelToken(AppSettings.name),
          useValue: modelMock,
        },
        { provide: GoogleSheetsService, useValue: mockSheetsService },
        { provide: ServiceAccountService, useValue: mockSaService },
      ],
    }).compile();

    service = module.get<AppSettingsService>(AppSettingsService);
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    await createModule();
  });

  // ─── get() ──────────────────────────────────────────────────────────────────

  describe('get()', () => {
    it('calls findOneAndUpdate with upsert + setOnInsert to auto-init', async () => {
      const doc = await service.get();

      expect(modelMock.findOneAndUpdate).toHaveBeenCalledWith(
        { key: 'singleton' },
        { $setOnInsert: { key: 'singleton' } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      expect(doc.key).toBe('singleton');
      expect(doc.crawlerEnabled).toBe(false);
      expect(doc.categoryList).toEqual([]);
    });

    it('returns existing doc on second call without creating a new one', async () => {
      const existingDoc = makeDefaultDoc({ spreadsheetId: 'sheet-abc' });
      modelMock._setStore(existingDoc);

      const doc = await service.get();

      expect(doc.spreadsheetId).toBe('sheet-abc');
      // findOneAndUpdate still called (no in-process cache per spec)
      expect(modelMock.findOneAndUpdate).toHaveBeenCalledTimes(1);
    });
  });

  // ─── update() ───────────────────────────────────────────────────────────────

  describe('update()', () => {
    it('applies $set patch and returns updated doc', async () => {
      const afterUpdate = makeDefaultDoc({ crawlerEnabled: true });
      modelMock._execFn.mockResolvedValueOnce(afterUpdate);

      const result = await service.update({ crawlerEnabled: true });

      expect(modelMock.findOneAndUpdate).toHaveBeenCalledWith(
        { key: 'singleton' },
        { $set: { crawlerEnabled: true } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      expect(result.crawlerEnabled).toBe(true);
    });

    it('partial update preserves unmodified fields', async () => {
      const partial = { delayBetweenLoopsMs: 60000 };
      const afterUpdate = makeDefaultDoc({ delayBetweenLoopsMs: 60000 });
      modelMock._execFn.mockResolvedValueOnce(afterUpdate);

      const result = await service.update(partial);

      expect(modelMock.findOneAndUpdate).toHaveBeenCalledWith(
        { key: 'singleton' },
        { $set: partial },
        expect.any(Object),
      );
      expect(result.delayBetweenLoopsMs).toBe(60000);
      // Other fields should remain at defaults
      expect(result.crawlerEnabled).toBe(false);
    });
  });

  // ─── updateStatus() ─────────────────────────────────────────────────────────

  describe('updateStatus()', () => {
    it('calls findOneAndUpdate with $set for status patch', async () => {
      await service.updateStatus({ crawlerStatus: 'running', loopCount: 3 });

      expect(modelMock.findOneAndUpdate).toHaveBeenCalledWith(
        { key: 'singleton' },
        { $set: { crawlerStatus: 'running', loopCount: 3 } },
        { upsert: true, setDefaultsOnInsert: true },
      );
    });
  });

  // ─── incrementLoopCount() — C1 atomic fix ───────────────────────────────────

  describe('incrementLoopCount()', () => {
    it('uses $inc operator (not $set) to atomically increment loopCount', async () => {
      await service.incrementLoopCount();

      expect(modelMock.findOneAndUpdate).toHaveBeenCalledWith(
        { key: 'singleton' },
        { $inc: { loopCount: 1 } },
        { upsert: true, setDefaultsOnInsert: true },
      );
    });

    it('does NOT include loopCount in a $set call (prevents non-atomic RMW)', async () => {
      await service.incrementLoopCount();

      const calls = modelMock.findOneAndUpdate.mock.calls as Array<
        [unknown, Record<string, unknown>, unknown]
      >;
      const setCall = calls.find(
        ([, op]) => op['$set'] && 'loopCount' in (op['$set'] as object),
      );
      expect(setCall).toBeUndefined();
    });
  });

  // ─── testSheetAccess() ───────────────────────────────────────────────────────

  describe('testSheetAccess()', () => {
    it('returns early when no spreadsheetId configured', async () => {
      // Default doc has spreadsheetId = ''
      const result = await service.testSheetAccess();

      expect(result.allOk).toBe(false);
      expect(result.message).toMatch(/spreadsheetId/i);
      expect(mockSheetsService.testAccess).not.toHaveBeenCalled();
    });

    it('returns early when no active SAs', async () => {
      mockSaService.findActiveDecrypted.mockResolvedValueOnce([]);
      modelMock._execFn.mockResolvedValueOnce(
        makeDefaultDoc({ spreadsheetId: 'sheet-xyz' }),
      );

      const result = await service.testSheetAccess('sheet-xyz');

      expect(result.allOk).toBe(false);
      expect(result.results).toHaveLength(0);
      expect(result.message).toMatch(/Service Account/i);
      expect(mockSheetsService.testAccess).not.toHaveBeenCalled();
    });

    it('calls GoogleSheetsService.testAccess and returns results', async () => {
      const sas = [
        {
          id: 'sa1',
          clientEmail: 'sa@test.iam.gserviceaccount.com',
          privateKey: 'pk1',
          label: '',
          projectId: '',
        },
      ];
      mockSaService.findActiveDecrypted.mockResolvedValueOnce(sas);
      mockSheetsService.testAccess.mockResolvedValueOnce([
        { saId: 'sa1', clientEmail: sas[0].clientEmail, ok: true },
      ]);

      const result = await service.testSheetAccess('sheet-xyz');

      expect(mockSheetsService.testAccess).toHaveBeenCalledWith('sheet-xyz', [
        { id: 'sa1', clientEmail: sas[0].clientEmail, privateKey: 'pk1' },
      ]);
      expect(result.allOk).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].ok).toBe(true);
    });

    it('returns allOk=false when any SA fails', async () => {
      const sas = [
        {
          id: 'sa1',
          clientEmail: 'sa1@x.iam.gserviceaccount.com',
          privateKey: 'pk1',
          label: '',
          projectId: '',
        },
        {
          id: 'sa2',
          clientEmail: 'sa2@x.iam.gserviceaccount.com',
          privateKey: 'pk2',
          label: '',
          projectId: '',
        },
      ];
      mockSaService.findActiveDecrypted.mockResolvedValueOnce(sas);
      mockSheetsService.testAccess.mockResolvedValueOnce([
        { saId: 'sa1', clientEmail: sas[0].clientEmail, ok: true },
        {
          saId: 'sa2',
          clientEmail: sas[1].clientEmail,
          ok: false,
          error: 'Permission denied',
        },
      ]);

      const result = await service.testSheetAccess('sheet-xyz');

      expect(result.allOk).toBe(false);
      expect(result.results[1].error).toBe('Permission denied');
    });
  });
});
