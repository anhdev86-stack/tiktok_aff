/**
 * Migration: unset deprecated sheet fields from tiktok_accounts collection.
 *
 * Usage (mongosh):
 *   mongosh "<MONGO_URI>" scripts/migration-remove-tiktok-account-sheet-fields.js
 *
 * Run ONLY after Phase 5 BE/FE deploy is live.
 * Operation is idempotent — safe to run multiple times.
 */

const r = db.tiktok_accounts.updateMany(
  {},
  {
    $unset: {
      spreadsheetId: '',
      sheetOverview: '',
      sheetTopVideos: '',
      sheetTrend: '',
    },
  },
);

print('Matched:', r.matchedCount, ' Modified:', r.modifiedCount);
