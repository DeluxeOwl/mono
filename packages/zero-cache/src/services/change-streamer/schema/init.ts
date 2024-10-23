import type {LogContext} from '@rocicorp/logger';
import {
  runSchemaMigrations,
  type IncrementalMigrationMap,
  type Migration,
} from '../../../db/migration.js';
import type {PostgresDB} from '../../../types/pg.js';
import {PG_SCHEMA, setupCDCTables} from './tables.js';

const setupMigration: Migration = {
  migrateSchema: setupCDCTables,
  minSafeVersion: 1,
};

const schemaVersionMigrationMap: IncrementalMigrationMap = {
  1: setupMigration,
  // There are no incremental migrations yet, but if we were to, say introduce
  // another column, setupCDCTables would be updated to create the table with
  // the new column, and then there would be an incremental migration here at
  // version `2` that adds the column for databases that were initialized to
  // version `1`.
};

export async function initChangeStreamerSchema(
  log: LogContext,
  db: PostgresDB,
): Promise<void> {
  await runSchemaMigrations(
    log,
    'change-streamer',
    PG_SCHEMA,
    db,
    setupMigration,
    schemaVersionMigrationMap,
  );
}
