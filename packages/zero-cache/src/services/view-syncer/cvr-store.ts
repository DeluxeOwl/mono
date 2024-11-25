import type {LogContext} from '@rocicorp/logger';
import {resolver} from '@rocicorp/resolver';
import type {MaybeRow, PendingQuery, Row} from 'postgres';
import {assert} from '../../../../shared/src/asserts.js';
import {CustomKeyMap} from '../../../../shared/src/custom-key-map.js';
import {
  deepEqual,
  type ReadonlyJSONValue,
} from '../../../../shared/src/json.js';
import {must} from '../../../../shared/src/must.js';
import {sleep} from '../../../../shared/src/sleep.js';
import {astSchema} from '../../../../zero-protocol/src/ast.js';
import {ErrorKind} from '../../../../zero-protocol/src/error.js';
import type {JSONValue} from '../../types/bigint-json.js';
import {ErrorForClient} from '../../types/error-for-client.js';
import type {PostgresDB, PostgresTransaction} from '../../types/pg.js';
import {rowIDHash} from '../../types/row-key.js';
import type {Patch, PatchToVersion} from './client-handler.js';
import type {CVR, CVRSnapshot} from './cvr.js';
import {
  type ClientsRow,
  type DesiresRow,
  type InstancesRow,
  type QueriesRow,
  rowRecordToRowsRow,
  type RowsRow,
  rowsRowToRowRecord,
} from './schema/cvr.js';
import {
  type ClientQueryRecord,
  type ClientRecord,
  cmpVersions,
  type CVRVersion,
  EMPTY_CVR_VERSION,
  type InternalQueryRecord,
  type NullableCVRVersion,
  type QueryPatch,
  type QueryRecord,
  type RowID,
  type RowRecord,
  versionFromString,
  versionString,
} from './schema/types.js';

type NotNull<T> = T extends null ? never : T;

export type CVRFlushStats = {
  instances: number;
  queries: number;
  desires: number;
  clients: number;
  rows: number;
  statements: number;
};

class RowRecordCache {
  #cache: Promise<CustomKeyMap<RowID, RowRecord>> | undefined;
  readonly #db: PostgresDB;
  readonly #cvrID: string;

  constructor(db: PostgresDB, cvrID: string) {
    this.#db = db;
    this.#cvrID = cvrID;
  }

  async #ensureLoaded(): Promise<CustomKeyMap<RowID, RowRecord>> {
    if (this.#cache) {
      return this.#cache;
    }
    const r = resolver<CustomKeyMap<RowID, RowRecord>>();
    // Set this.#cache immediately (before await) so that only one db
    // query is made even if there are multiple callers.
    this.#cache = r.promise;

    const cache: CustomKeyMap<RowID, RowRecord> = new CustomKeyMap(rowIDHash);
    for await (const rows of this.#db<
      RowsRow[]
    >`SELECT * FROM cvr.rows WHERE "clientGroupID" = ${
      this.#cvrID
    } AND "refCounts" IS NOT NULL`
      // TODO(arv): Arbitrary page size
      .cursor(5000)) {
      for (const row of rows) {
        const rowRecord = rowsRowToRowRecord(row);
        cache.set(rowRecord.id, rowRecord);
      }
    }
    r.resolve(cache);
    return this.#cache;
  }

  getRowRecords(): Promise<ReadonlyMap<RowID, RowRecord>> {
    return this.#ensureLoaded();
  }

  async flush(rowRecords: Iterable<RowRecord>) {
    const cache = await this.#ensureLoaded();
    for (const row of rowRecords) {
      if (row.refCounts === null) {
        cache.delete(row.id);
      } else {
        cache.set(row.id, row);
      }
    }
  }

  clear() {
    this.#cache = undefined;
  }

  async *catchupRowPatches(
    lc: LogContext,
    afterVersion: NullableCVRVersion,
    upToCVR: CVRSnapshot,
    excludeQueryHashes: string[] = [],
  ): AsyncGenerator<RowsRow[], void, undefined> {
    if (cmpVersions(afterVersion, upToCVR.version) >= 0) {
      return;
    }

    const startMs = Date.now();
    const sql = this.#db;
    const start = afterVersion ? versionString(afterVersion) : '';
    const end = versionString(upToCVR.version);
    lc.debug?.(`scanning row patches for clients from ${start}`);

    const query =
      excludeQueryHashes.length === 0
        ? sql<RowsRow[]>`SELECT * FROM cvr.rows
        WHERE "clientGroupID" = ${this.#cvrID}
          AND "patchVersion" > ${start}
          AND "patchVersion" <= ${end}`
        : // Exclude rows that were already sent as part of query hydration.
          sql<RowsRow[]>`SELECT * FROM cvr.rows
        WHERE "clientGroupID" = ${this.#cvrID}
          AND "patchVersion" > ${start}
          AND "patchVersion" <= ${end}
          AND ("refCounts" IS NULL OR NOT "refCounts" ?| ${excludeQueryHashes})`;

    yield* query.cursor(10000);

    lc.debug?.(`finished row catchup (${Date.now() - startMs} ms)`);
  }

  executeRowUpdates(
    tx: PostgresTransaction,
    version: CVRVersion,
    rowRecordsToFlush: RowRecord[],
  ): PendingQuery<Row[]>[] {
    const rowRecordRows = rowRecordsToFlush.map(r =>
      rowRecordToRowsRow(this.#cvrID, r),
    );
    const rowsVersion = {
      clientGroupID: this.#cvrID,
      version: versionString(version),
    };
    const pending: PendingQuery<Row[]>[] = [
      tx`INSERT INTO cvr."rowsVersion" ${tx(rowsVersion)}
           ON CONFLICT ("clientGroupID") 
           DO UPDATE SET ${tx(rowsVersion)}`.execute(),
    ];
    let i = 0;
    while (i < rowRecordRows.length) {
      pending.push(
        tx`INSERT INTO cvr.rows ${tx(
          rowRecordRows.slice(i, i + ROW_RECORD_UPSERT_BATCH_SIZE),
        )} 
          ON CONFLICT ("clientGroupID", "schema", "table", "rowKey")
          DO UPDATE SET "rowVersion" = excluded."rowVersion",
            "patchVersion" = excluded."patchVersion",
            "refCounts" = excluded."refCounts"`.execute(),
      );
      i += ROW_RECORD_UPSERT_BATCH_SIZE;
    }
    return pending;
  }
}

type QueryRow = {
  queryHash: string;
  clientAST: NotNull<JSONValue>;
  patchVersion: string | null;
  transformationHash: string | null;
  transformationVersion: string | null;
  internal: boolean | null;
  deleted: boolean | null;
};

function asQuery(row: QueryRow): QueryRecord {
  const ast = astSchema.parse(row.clientAST);
  const maybeVersion = (s: string | null) =>
    s === null ? undefined : versionFromString(s);
  return row.internal
    ? ({
        id: row.queryHash,
        ast,
        transformationHash: row.transformationHash ?? undefined,
        transformationVersion: maybeVersion(row.transformationVersion),
        internal: true,
      } satisfies InternalQueryRecord)
    : ({
        id: row.queryHash,
        ast,
        patchVersion: maybeVersion(row.patchVersion),
        desiredBy: {},
        transformationHash: row.transformationHash ?? undefined,
        transformationVersion: maybeVersion(row.transformationVersion),
      } satisfies ClientQueryRecord);
}

// The time to wait between load attempts.
const LOAD_ATTEMPT_INTERVAL_MS = 500;
// The maximum number of load() attempts if the rowsVersion is behind.
// This currently results in a maximum catchup time of ~5 seconds, after
// which we give up and consider the CVR invalid.
//
// TODO: Make this configurable with something like --max-catchup-wait-ms,
//       as it is technically application specific.
const MAX_LOAD_ATTEMPTS = 10;

export class CVRStore {
  readonly #lc: LogContext;
  readonly #taskID: string;
  readonly #id: string;
  readonly #db: PostgresDB;
  readonly #writes: Set<{
    stats: Partial<CVRFlushStats>;
    write: (
      tx: PostgresTransaction,
      lastConnectTime: number,
    ) => PendingQuery<MaybeRow[]>;
  }> = new Set();
  readonly #pendingRowRecordPuts = new CustomKeyMap<RowID, RowRecord>(
    rowIDHash,
  );
  readonly #rowCache: RowRecordCache;
  readonly #loadAttemptIntervalMs: number;
  readonly #maxLoadAttempts: number;

  constructor(
    lc: LogContext,
    db: PostgresDB,
    taskID: string,
    cvrID: string,
    loadAttemptIntervalMs = LOAD_ATTEMPT_INTERVAL_MS,
    maxLoadAttempts = MAX_LOAD_ATTEMPTS,
  ) {
    this.#lc = lc;
    this.#db = db;
    this.#taskID = taskID;
    this.#id = cvrID;
    this.#rowCache = new RowRecordCache(db, cvrID);
    this.#loadAttemptIntervalMs = loadAttemptIntervalMs;
    this.#maxLoadAttempts = maxLoadAttempts;
  }

  async load(lastConnectTime: number): Promise<CVR> {
    let err: RowsVersionBehindError | undefined;
    for (let i = 0; i < this.#maxLoadAttempts; i++) {
      if (i > 0) {
        await sleep(this.#loadAttemptIntervalMs);
      }
      const result = await this.#load(lastConnectTime);
      if (result instanceof RowsVersionBehindError) {
        this.#lc.info?.(`attempt ${i + 1}: ${String(result)}`);
        err = result;
        continue;
      }
      return result;
    }
    assert(err);
    throw new ErrorForClient([
      'error',
      ErrorKind.ClientNotFound,
      `max attempts exceeded waiting for CVR@${err.cvrVersion} to catch up from ${err.rowsVersion}`,
    ]);
  }

  async #load(lastConnectTime: number): Promise<CVR | RowsVersionBehindError> {
    const start = Date.now();

    const id = this.#id;
    const cvr: CVR = {
      id,
      version: EMPTY_CVR_VERSION,
      lastActive: 0,
      replicaVersion: null,
      clients: {},
      queries: {},
    };

    const [instance, clientsRows, queryRows, desiresRows] =
      await this.#db.begin(tx => [
        tx<
          (Omit<InstancesRow, 'clientGroupID'> & {rowsVersion: string | null})[]
        >`SELECT cvr."version", 
                 "lastActive", 
                 "replicaVersion", 
                 "owner", 
                 "grantedAt", 
                 rows."version" as "rowsVersion"
            FROM cvr.instances AS cvr
            LEFT JOIN cvr."rowsVersion" AS rows 
            ON cvr."clientGroupID" = rows."clientGroupID"
            WHERE cvr."clientGroupID" = ${id}`,
        tx<
          Pick<ClientsRow, 'clientID' | 'patchVersion'>[]
        >`SELECT "clientID", "patchVersion" FROM cvr.clients WHERE "clientGroupID" = ${id}`,
        tx<
          QueryRow[]
        >`SELECT * FROM cvr.queries WHERE "clientGroupID" = ${id} AND (deleted IS NULL OR deleted = FALSE)`,
        tx<
          DesiresRow[]
        >`SELECT * FROM cvr.desires WHERE "clientGroupID" = ${id} AND (deleted IS NULL OR deleted = FALSE)`,
      ]);

    if (instance.length === 0) {
      // This is the first time we see this CVR.
      this.putInstance({
        version: cvr.version,
        lastActive: 0,
        replicaVersion: null,
      });
    } else {
      assert(instance.length === 1);
      const {
        version,
        lastActive,
        replicaVersion,
        owner,
        grantedAt,
        rowsVersion,
      } = instance[0];

      if (owner !== this.#taskID) {
        if ((grantedAt ?? 0) > lastConnectTime) {
          throw new OwnershipError(owner, grantedAt);
        } else {
          // Fire-and-forget an ownership change to signal the current owner.
          // Note that the query is structured such that it only succeeds in the
          // correct conditions (i.e. gated on `grantedAt`).
          void this.#db`
            UPDATE cvr.instances SET "owner"     = ${this.#taskID}, 
                                     "grantedAt" = ${lastConnectTime}
              WHERE "clientGroupID" = ${this.#id} AND
                    ("grantedAt" IS NULL OR
                     "grantedAt" <= to_timestamp(${lastConnectTime / 1000}))
        `.execute();
        }
      }

      if (version !== (rowsVersion ?? EMPTY_CVR_VERSION.stateVersion)) {
        // This will cause the load() method to wait for row catchup and retry.
        // Assuming the ownership signal succeeds, the current owner will stop
        // modifying the CVR and flush its pending row changes.
        return new RowsVersionBehindError(version, rowsVersion);
      }

      cvr.version = versionFromString(version);
      cvr.lastActive = lastActive;
      cvr.replicaVersion = replicaVersion;
    }

    for (const row of clientsRows) {
      const version = versionFromString(row.patchVersion);
      cvr.clients[row.clientID] = {
        id: row.clientID,
        patchVersion: version,
        desiredQueryIDs: [],
      };
    }

    for (const row of queryRows) {
      const query = asQuery(row);
      cvr.queries[row.queryHash] = query;
    }

    for (const row of desiresRows) {
      const client = cvr.clients[row.clientID];
      assert(client, 'Client not found');
      client.desiredQueryIDs.push(row.queryHash);

      const query = cvr.queries[row.queryHash];
      if (query && !query.internal) {
        query.desiredBy[row.clientID] = versionFromString(row.patchVersion);
      }
    }
    this.#lc.debug?.(
      `loaded CVR @${versionString(cvr.version)} (${Date.now() - start} ms)`,
    );

    return cvr;
  }

  getRowRecords(): Promise<ReadonlyMap<RowID, RowRecord>> {
    return this.#rowCache.getRowRecords();
  }

  getPendingRowRecord(id: RowID): RowRecord | undefined {
    return this.#pendingRowRecordPuts.get(id);
  }

  putRowRecord(row: RowRecord): void {
    this.#pendingRowRecordPuts.set(row.id, row);
  }

  putInstance({
    version,
    replicaVersion,
    lastActive,
  }: Pick<CVRSnapshot, 'version' | 'replicaVersion' | 'lastActive'>): void {
    this.#writes.add({
      stats: {instances: 1},
      write: (tx, lastConnectTime) => {
        const change: InstancesRow = {
          clientGroupID: this.#id,
          version: versionString(version),
          lastActive,
          replicaVersion,
          owner: this.#taskID,
          grantedAt: lastConnectTime,
        };
        return tx`
        INSERT INTO cvr.instances ${tx(change)} 
          ON CONFLICT ("clientGroupID") DO UPDATE SET ${tx(change)}`;
      },
    });
  }

  markQueryAsDeleted(version: CVRVersion, queryPatch: QueryPatch): void {
    this.#writes.add({
      stats: {queries: 1},
      write: tx => tx`UPDATE cvr.queries SET ${tx({
        patchVersion: versionString(version),
        deleted: true,
        transformationHash: null,
        transformationVersion: null,
      })}
      WHERE "clientGroupID" = ${this.#id} AND "queryHash" = ${queryPatch.id}`,
    });
  }

  putQuery(query: QueryRecord): void {
    const maybeVersionString = (v: CVRVersion | undefined) =>
      v ? versionString(v) : null;

    const change: QueriesRow = query.internal
      ? {
          clientGroupID: this.#id,
          queryHash: query.id,
          clientAST: query.ast,
          patchVersion: null,
          transformationHash: query.transformationHash ?? null,
          transformationVersion: maybeVersionString(
            query.transformationVersion,
          ),
          internal: true,
          deleted: false, // put vs del "got" query
        }
      : {
          clientGroupID: this.#id,
          queryHash: query.id,
          clientAST: query.ast,
          patchVersion: maybeVersionString(query.patchVersion),
          transformationHash: query.transformationHash ?? null,
          transformationVersion: maybeVersionString(
            query.transformationVersion,
          ),
          internal: null,
          deleted: false, // put vs del "got" query
        };
    this.#writes.add({
      stats: {queries: 1},
      write: tx => tx`INSERT INTO cvr.queries ${tx(change)}
      ON CONFLICT ("clientGroupID", "queryHash")
      DO UPDATE SET ${tx(change)}`,
    });
  }

  updateQuery(query: QueryRecord) {
    const maybeVersionString = (v: CVRVersion | undefined) =>
      v ? versionString(v) : null;

    const change: Pick<
      QueriesRow,
      | 'patchVersion'
      | 'transformationHash'
      | 'transformationVersion'
      | 'deleted'
    > = {
      patchVersion: query.internal
        ? null
        : maybeVersionString(query.patchVersion),
      transformationHash: query.transformationHash ?? null,
      transformationVersion: maybeVersionString(query.transformationVersion),
      deleted: false,
    };

    this.#writes.add({
      stats: {queries: 1},
      write: tx => tx`UPDATE cvr.queries SET ${tx(change)}
      WHERE "clientGroupID" = ${this.#id} AND "queryHash" = ${query.id}`,
    });
  }

  updateClientPatchVersion(clientID: string, patchVersion: CVRVersion): void {
    this.#writes.add({
      stats: {clients: 1},
      write: tx => tx`UPDATE cvr.clients
      SET "patchVersion" = ${versionString(patchVersion)}
      WHERE "clientGroupID" = ${this.#id} AND "clientID" = ${clientID}`,
    });
  }

  insertClient(client: ClientRecord): void {
    const change: ClientsRow = {
      clientGroupID: this.#id,
      clientID: client.id,
      patchVersion: versionString(client.patchVersion),
      // TODO(arv): deleted is never set to true
      deleted: false,
    };

    this.#writes.add({
      stats: {clients: 1},
      write: tx => tx`INSERT INTO cvr.clients ${tx(change)}`,
    });
  }

  insertDesiredQuery(
    newVersion: CVRVersion,
    query: {id: string},
    client: {id: string},
    deleted: boolean,
  ): void {
    const change: DesiresRow = {
      clientGroupID: this.#id,
      clientID: client.id,
      queryHash: query.id,
      patchVersion: versionString(newVersion),
      deleted,
    };
    this.#writes.add({
      stats: {desires: 1},
      write: tx => tx`
      INSERT INTO cvr.desires ${tx(change)}
        ON CONFLICT ("clientGroupID", "clientID", "queryHash")
        DO UPDATE SET ${tx(change)}
      `,
    });
  }

  catchupRowPatches(
    lc: LogContext,
    afterVersion: NullableCVRVersion,
    upToCVR: CVRSnapshot,
    excludeQueryHashes: string[] = [],
  ): AsyncGenerator<RowsRow[], void, undefined> {
    return this.#rowCache.catchupRowPatches(
      lc,
      afterVersion,
      upToCVR,
      excludeQueryHashes,
    );
  }

  async catchupConfigPatches(
    lc: LogContext,
    afterVersion: NullableCVRVersion,
    upToCVR: CVRSnapshot,
  ): Promise<PatchToVersion[]> {
    if (cmpVersions(afterVersion, upToCVR.version) >= 0) {
      return [];
    }

    const startMs = Date.now();
    const sql = this.#db;
    const start = afterVersion ? versionString(afterVersion) : '';
    const end = versionString(upToCVR.version);
    lc.debug?.(`scanning config patches for clients from ${start}`);

    const [allDesires, clientRows, queryRows] = await Promise.all([
      sql<DesiresRow[]>`SELECT * FROM cvr.desires
       WHERE "clientGroupID" = ${this.#id}
        AND "patchVersion" > ${start}
        AND "patchVersion" <= ${end}`,
      sql<ClientsRow[]>`SELECT * FROM cvr.clients
       WHERE "clientGroupID" = ${this.#id}
        AND "patchVersion" > ${start}
        AND "patchVersion" <= ${end}`,
      sql<
        Pick<QueriesRow, 'deleted' | 'queryHash' | 'patchVersion'>[]
      >`SELECT deleted, "queryHash", "patchVersion" FROM cvr.queries
      WHERE "clientGroupID" = ${this.#id}
        AND "patchVersion" > ${start}
        AND "patchVersion" <= ${end}`,
    ]);

    const ast = (id: string) => must(upToCVR.queries[id]).ast;

    const patches: PatchToVersion[] = [];
    for (const row of queryRows) {
      const {queryHash: id} = row;
      const patch: Patch = row.deleted
        ? {type: 'query', op: 'del', id}
        : {type: 'query', op: 'put', id, ast: ast(id)};
      const v = row.patchVersion;
      assert(v);
      patches.push({patch, toVersion: versionFromString(v)});
    }
    for (const row of clientRows) {
      const patch: Patch = {
        type: 'client',
        op: row.deleted ? 'del' : 'put',
        id: row.clientID,
      };
      patches.push({patch, toVersion: versionFromString(row.patchVersion)});
    }
    for (const row of allDesires) {
      const {clientID, queryHash: id} = row;
      const patch: Patch = row.deleted
        ? {type: 'query', op: 'del', id, clientID}
        : {type: 'query', op: 'put', id, clientID, ast: ast(id)};
      patches.push({patch, toVersion: versionFromString(row.patchVersion)});
    }

    lc.debug?.(`${patches.length} config patches (${Date.now() - startMs} ms)`);
    return patches;
  }

  async #checkVersionAndOwnership(
    tx: PostgresTransaction,
    expectedCurrentVersion: CVRVersion,
    lastConnectTime: number,
  ): Promise<void> {
    const expected = versionString(expectedCurrentVersion);
    const result = await tx<
      Pick<InstancesRow, 'version' | 'owner' | 'grantedAt'>[]
    >`SELECT "version", "owner", "grantedAt" FROM cvr.instances 
        WHERE "clientGroupID" = ${this.#id}`.execute(); // Note: execute() immediately to send the query before others.
    const {version, owner, grantedAt} =
      result.length > 0
        ? result[0]
        : {
            version: EMPTY_CVR_VERSION.stateVersion,
            owner: null,
            grantedAt: null,
          };
    if (version !== expected) {
      throw new ConcurrentModificationException(expected, version);
    }
    if (owner !== this.#taskID && (grantedAt ?? 0) > lastConnectTime) {
      throw new OwnershipError(owner, grantedAt);
    }
  }

  async #flush(
    expectedCurrentVersion: CVRVersion,
    newVersion: CVRVersion,
    lastConnectTime: number,
  ): Promise<CVRFlushStats> {
    const stats: CVRFlushStats = {
      instances: 0,
      queries: 0,
      desires: 0,
      clients: 0,
      rows: 0,
      statements: 0,
    };
    const existingRowRecords = await this.getRowRecords();
    const rowRecordsToFlush = [...this.#pendingRowRecordPuts.values()].filter(
      row => {
        const existing = existingRowRecords.get(row.id);
        return (
          (existing !== undefined || row.refCounts !== null) &&
          !deepEqual(
            row as ReadonlyJSONValue,
            existing as ReadonlyJSONValue | undefined,
          )
        );
      },
    );
    stats.rows = rowRecordsToFlush.length;
    await this.#db.begin(tx => {
      const pipelined: Promise<unknown>[] = [
        // Read the version and ownership to detect concurrent writes.
        this.#checkVersionAndOwnership(
          tx,
          expectedCurrentVersion,
          lastConnectTime,
        ),
      ];

      for (const write of this.#writes) {
        stats.instances += write.stats.instances ?? 0;
        stats.queries += write.stats.queries ?? 0;
        stats.desires += write.stats.desires ?? 0;
        stats.clients += write.stats.clients ?? 0;

        pipelined.push(write.write(tx, lastConnectTime).execute());
        stats.statements++;
      }

      const rowUpdates = this.#rowCache.executeRowUpdates(
        tx,
        newVersion,
        rowRecordsToFlush,
      );
      pipelined.push(...rowUpdates);
      stats.statements += rowUpdates.length;

      // Make sure Errors thrown by pipelined statements
      // are propagated up the stack.
      return Promise.all(pipelined);
    });
    await this.#rowCache.flush(rowRecordsToFlush);
    return stats;
  }

  async flush(
    expectedCurrentVersion: CVRVersion,
    newVersion: CVRVersion,
    lastConnectTime: number,
  ): Promise<CVRFlushStats> {
    try {
      return await this.#flush(
        expectedCurrentVersion,
        newVersion,
        lastConnectTime,
      );
    } catch (e) {
      // Clear cached state if an error (e.g. ConcurrentModificationException) is encountered.
      this.#rowCache.clear();
      throw e;
    } finally {
      this.#writes.clear();
      this.#pendingRowRecordPuts.clear();
    }
  }
}

// Max number of parameters for our sqlite build is 65534.
// Each row record has 7 parameters (1 per column).
// 65534 / 7 = 9362
const ROW_RECORD_UPSERT_BATCH_SIZE = 9_360;

export class ConcurrentModificationException extends Error {
  readonly name = 'ConcurrentModificationException';

  constructor(expectedVersion: string, actualVersion: string) {
    super(
      `CVR has been concurrently modified. Expected ${expectedVersion}, got ${actualVersion}`,
    );
  }
}

export class OwnershipError extends Error {
  readonly name = 'OwnershipError';

  constructor(owner: string | null, grantedAt: number | null) {
    super(
      `CVR ownership was transferred to ${owner} at ${new Date(
        grantedAt ?? 0,
      ).toISOString()}`,
    );
  }
}

export class RowsVersionBehindError extends Error {
  readonly name = 'RowsVersionBehindError';
  readonly cvrVersion: string;
  readonly rowsVersion: string | null;

  constructor(cvrVersion: string, rowsVersion: string | null) {
    super(`rowsVersion (${rowsVersion}) is behind CVR ${cvrVersion}`);
    this.cvrVersion = cvrVersion;
    this.rowsVersion = rowsVersion;
  }
}
