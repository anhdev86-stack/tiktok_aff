/**
 * Migration: Drop legacy collections — creators + profile_jobs
 *
 * SAFETY: Only executes when env MIGRATE_CONFIRM=yes to prevent accidental drop.
 *
 * Prerequisites:
 *   1. mongodump backup must be completed and archived first (see note below).
 *   2. BE must be stopped or redeployed without CreatorModule / ProfileJobModule
 *      (Phase 4 cleanup completed).
 *
 * Usage (manual run on production host):
 *   MIGRATE_CONFIRM=yes npx ts-node src/migrations/2026-05-11-drop-legacy-collections.ts
 *
 * Or via mongosh directly (after backup):
 *   mongosh "<MONGO_URI>" --eval 'db.creators.drop(); db.profile_jobs.drop();'
 *
 * Backup command (run BEFORE this migration):
 *   mongodump --uri="<MONGO_URI>" --db=<DB_NAME> \
 *     --collection=creators \
 *     --out=./backup-pre-cleanup-2026-05-11
 *   mongodump --uri="<MONGO_URI>" --db=<DB_NAME> \
 *     --collection=profile_jobs \
 *     --out=./backup-pre-cleanup-2026-05-11
 *
 * Restore (rollback):
 *   mongorestore --uri="<MONGO_URI>" --db=<DB_NAME> \
 *     ./backup-pre-cleanup-2026-05-11/<DB_NAME>/creators.bson
 *   mongorestore --uri="<MONGO_URI>" --db=<DB_NAME> \
 *     ./backup-pre-cleanup-2026-05-11/<DB_NAME>/profile_jobs.bson
 *
 * NOTE: This file is intentionally NOT executed during P4 implementation.
 * Drop will be run manually on production after confirming backup is archived.
 */

import { MongoClient } from 'mongodb';

const LEGACY_COLLECTIONS = ['creators', 'profile_jobs'] as const;

async function run() {
  if (process.env.MIGRATE_CONFIRM !== 'yes') {
    console.error(
      'Aborting: set env MIGRATE_CONFIRM=yes to confirm drop operation.',
    );
    process.exit(1);
  }

  const uri = process.env.MONGO_URI;
  const dbName = process.env.MONGO_DB;

  if (!uri || !dbName) {
    console.error('Missing MONGO_URI or MONGO_DB environment variables.');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);

    const existingCollections = await db
      .listCollections()
      .toArray()
      .then((cols) => cols.map((c) => c.name));

    for (const name of LEGACY_COLLECTIONS) {
      if (existingCollections.includes(name)) {
        await db.collection(name).drop();
        console.log(`Dropped collection: ${name}`);
      } else {
        console.log(`Collection not found (already dropped?): ${name}`);
      }
    }

    const remaining = await db
      .listCollections()
      .toArray()
      .then((cols) => cols.map((c) => c.name));
    console.log('Remaining collections:', remaining);
  } finally {
    await client.close();
  }
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
