import {afterEach, beforeEach, describe, expect, test} from '@jest/globals';
import {Lock} from '@rocicorp/lock';
import type postgres from 'postgres';
import {sleep} from 'shared/src/sleep.js';
import {
  dropReplicationSlot,
  expectTables,
  initDB,
  testDBs,
} from '../../test/db.js';
import {createSilentLogContext} from '../../test/logger.js';
import {versionFromLexi, type LexiVersion} from '../../types/lexi-version.js';
import {IncrementalSyncer, setupReplicationTables} from './incremental-sync.js';
import {replicationSlot, setupUpstream} from './initial-sync.js';
import {getPublicationInfo} from './tables/published.js';
import type {TableSpec} from './tables/specs.js';

const REPLICA_ID = 'incremental_sync_test_id';

describe('replicator/incremental-sync', () => {
  let upstream: postgres.Sql;
  let replica: postgres.Sql;
  let syncer: IncrementalSyncer;

  beforeEach(async () => {
    upstream = await testDBs.create('incremental_sync_test_upstream');
    replica = await testDBs.create('incremental_sync_test_replica');
    syncer = new IncrementalSyncer(
      'postgres:///incremental_sync_test_upstream',
      REPLICA_ID,
      replica,
      new Lock(),
    );
  });

  afterEach(async () => {
    await syncer.stop(createSilentLogContext());
    await dropReplicationSlot(upstream, replicationSlot(REPLICA_ID));
    await testDBs.drop(replica, upstream);
  });

  type Case = {
    name: string;
    setupUpstream?: string;
    setupReplica?: string;
    writeUpstream?: string[];
    expectedTransactions?: number;
    specs: Record<string, TableSpec>;
    data: Record<string, Record<string, unknown>[]>;
  };

  const cases: Case[] = [
    {
      name: 'create tables',
      specs: {},
      data: {
        ['_zero.TxLog']: [],
        ['_zero.ChangeLog']: [],
        ['_zero.InvalidationRegistry']: [],
        ['_zero.InvalidationIndex']: [],
      },
    },
    {
      name: 'alter version columns',
      setupReplica: `
      CREATE TABLE issues(
        "issueID" INTEGER PRIMARY KEY,
        _0_version VARCHAR(38) DEFAULT '00'
      );
      CREATE PUBLICATION zero_data FOR TABLES IN SCHEMA public;

      CREATE SCHEMA zero;
      CREATE TABLE zero.clients(
        "clientID" TEXT PRIMARY KEY,
        "lastMutationID" TEXT,
        _0_version VARCHAR(38) DEFAULT '00'
      );
      CREATE PUBLICATION zero_meta FOR TABLES IN SCHEMA zero;
      `,
      specs: {
        ['public.issues']: {
          schema: 'public',
          name: 'issues',
          columns: {
            issueID: {
              dataType: 'int4',
              characterMaximumLength: null,
              columnDefault: null,
              notNull: true,
            },
            ['_0_version']: {
              dataType: 'varchar',
              characterMaximumLength: 38,
              columnDefault: null,
              notNull: true,
            },
          },
          primaryKey: ['issueID'],
        },
        ['zero.clients']: {
          schema: 'zero',
          name: 'clients',
          columns: {
            clientID: {
              dataType: 'text',
              characterMaximumLength: null,
              columnDefault: null,
              notNull: true,
            },
            lastMutationID: {
              dataType: 'text',
              characterMaximumLength: null,
              columnDefault: null,
              notNull: false,
            },
            ['_0_version']: {
              dataType: 'varchar',
              characterMaximumLength: 38,
              columnDefault: null, // Default should be cleared.
              notNull: true,
            },
          },
          primaryKey: ['clientID'],
        },
      },
      data: {
        ['_zero.TxLog']: [],
        ['_zero.ChangeLog']: [],
        ['_zero.InvalidationRegistry']: [],
        ['_zero.InvalidationIndex']: [],
      },
    },
    {
      name: 'insert rows',
      setupUpstream: `
      CREATE TABLE issues(
        "issueID" INTEGER PRIMARY KEY,
        big BIGINT,
        ints INTEGER[],
        bigs BIGINT[],
        time TIMESTAMPTZ,
        description TEXT
      );
      CREATE PUBLICATION zero_all FOR TABLES IN SCHEMA public;
      `,
      setupReplica: `
      CREATE TABLE issues(
        "issueID" INTEGER PRIMARY KEY,
        big BIGINT,
        ints INTEGER[],
        bigs BIGINT[],
        time TIMESTAMPTZ,
        description TEXT,
        _0_version VARCHAR(38) DEFAULT '00'
      );
      CREATE PUBLICATION zero_all FOR TABLES IN SCHEMA public;
      `,
      specs: {
        ['public.issues']: {
          schema: 'public',
          name: 'issues',
          columns: {
            issueID: {
              dataType: 'int4',
              characterMaximumLength: null,
              columnDefault: null,
              notNull: true,
            },
            big: {
              dataType: 'int8',
              characterMaximumLength: null,
              columnDefault: null,
              notNull: false,
            },
            ints: {
              dataType: 'int4[]',
              characterMaximumLength: null,
              columnDefault: null,
              notNull: false,
            },
            bigs: {
              dataType: 'int8[]',
              characterMaximumLength: null,
              columnDefault: null,
              notNull: false,
            },
            time: {
              dataType: 'timestamptz',
              characterMaximumLength: null,
              columnDefault: null,
              notNull: false,
            },
            description: {
              dataType: 'text',
              characterMaximumLength: null,
              columnDefault: null,
              notNull: false,
            },
            ['_0_version']: {
              dataType: 'varchar',
              characterMaximumLength: 38,
              columnDefault: null,
              notNull: true,
            },
          },
          primaryKey: ['issueID'],
        },
      },
      writeUpstream: [
        `
      INSERT INTO issues ("issueID") VALUES (123);
      INSERT INTO issues ("issueID", time) VALUES (456, '2024-03-21T18:50:23.646716Z');
      `,
        `
      INSERT INTO issues ("issueID", big) VALUES (789, 9223372036854775807);
      INSERT INTO issues ("issueID", ints) VALUES (987, '{92233720,123}');

      -- https://github.com/porsager/postgres/issues/837
      -- INSERT INTO issues ("issueID", bigs) VALUES (2468, '{9223372036854775807,123}');
      `,
      ],
      expectedTransactions: 2,
      data: {
        ['public.issues']: [
          {
            issueID: 123,
            big: null,
            ints: null,
            bigs: null,
            time: null,
            description: null,
            ['_0_version']: '01',
          },
          {
            issueID: 456,
            big: null,
            ints: null,
            bigs: null,
            time: new Date(Date.UTC(2024, 2, 21, 18, 50, 23, 646)), // Note: we lost the microseconds
            description: null,
            ['_0_version']: '01',
          },
          {
            issueID: 789,
            big: 9223372036854775807n,
            ints: null,
            bigs: null,
            time: null,
            description: null,
            ['_0_version']: '02',
          },
          {
            issueID: 987,
            big: null,
            ints: [92233720, 123],
            bigs: null,
            time: null,
            description: null,
            ['_0_version']: '02',
          },
          // https://github.com/porsager/postgres/issues/837
          // {
          //   issueID: 2468,
          //   big: null,
          //   ints: null,
          //   bigs: [9223372036854775807n, 123n],
          //   time: null,
          //   description: null,
          //   ['_0_version']: '02',
          // },
        ],
        ['_zero.ChangeLog']: [
          {
            stateVersion: '01',
            tableName: 'public.issues',
            op: 's',
            rowKeyHash: 'mB47UNOLHRciNkgYYlEm1A',
            rowKey: {issueID: 123},
            row: {
              issueID: 123,
              big: null,
              ints: null,
              bigs: null,
              time: null,
              description: null,
              ['_0_version']: '01',
            },
          },
          {
            stateVersion: '01',
            tableName: 'public.issues',
            op: 's',
            rowKeyHash: 'Lap0XW7zwx6r-rGbUDWBrw',
            rowKey: {issueID: 456},
            row: {
              issueID: 456,
              big: null,
              ints: null,
              bigs: null,
              time: '2024-03-21T18:50:23.646Z',
              description: null,
              ['_0_version']: '01',
            },
          },
          {
            stateVersion: '02',
            tableName: 'public.issues',
            op: 's',
            rowKeyHash: 'yyqwdGt-8VzhDgeVMot1pw',
            rowKey: {issueID: 789},
            row: {
              issueID: 789,
              big: 9223372036854775807n,
              ints: null,
              bigs: null,
              time: null,
              description: null,
              ['_0_version']: '02',
            },
          },
          {
            stateVersion: '02',
            tableName: 'public.issues',
            op: 's',
            rowKeyHash: 'iXRVI9CkqApw0uyS73RXSQ',
            rowKey: {issueID: 987},
            row: {
              issueID: 987,
              big: null,
              ints: [92233720, 123],
              bigs: null,
              time: null,
              description: null,
              ['_0_version']: '02',
            },
          },
        ],
      },
    },
    {
      name: 'update rows with multiple key columns and key value updates',
      setupUpstream: `
      CREATE TABLE issues(
        "issueID" INTEGER,
        "orgID" INTEGER,
        description TEXT,
        PRIMARY KEY("orgID", "issueID")
      );
      CREATE PUBLICATION zero_all FOR TABLES IN SCHEMA public;
      `,
      setupReplica: `
      CREATE TABLE issues(
        "issueID" INTEGER,
        "orgID" INTEGER,
        description TEXT,
        _0_version VARCHAR(38) DEFAULT '00',
        PRIMARY KEY("orgID", "issueID")
      );
      CREATE PUBLICATION zero_all FOR TABLES IN SCHEMA public;
      `,
      specs: {
        ['public.issues']: {
          schema: 'public',
          name: 'issues',
          columns: {
            issueID: {
              dataType: 'int4',
              characterMaximumLength: null,
              columnDefault: null,
              notNull: true,
            },
            orgID: {
              dataType: 'int4',
              characterMaximumLength: null,
              columnDefault: null,
              notNull: true,
            },
            description: {
              dataType: 'text',
              characterMaximumLength: null,
              columnDefault: null,
              notNull: false,
            },
            ['_0_version']: {
              dataType: 'varchar',
              characterMaximumLength: 38,
              columnDefault: null,
              notNull: true,
            },
          },
          primaryKey: ['orgID', 'issueID'],
        },
      },
      writeUpstream: [
        `
      INSERT INTO issues ("orgID", "issueID") VALUES (1, 123);
      INSERT INTO issues ("orgID", "issueID") VALUES (1, 456);
      INSERT INTO issues ("orgID", "issueID") VALUES (2, 789);
      `,
        `
      UPDATE issues SET (description) = ROW('foo') WHERE "issueID" = 456;
      UPDATE issues SET ("orgID", description) = ROW(2, 'bar') WHERE "issueID" = 123;
      `,
      ],
      expectedTransactions: 2,
      data: {
        ['public.issues']: [
          {orgID: 2, issueID: 123, description: 'bar', ['_0_version']: '02'},
          {orgID: 1, issueID: 456, description: 'foo', ['_0_version']: '02'},
          {orgID: 2, issueID: 789, description: null, ['_0_version']: '01'},
        ],
        ['_zero.ChangeLog']: [
          {
            stateVersion: '01',
            tableName: 'public.issues',
            op: 's',
            rowKeyHash: 'd4LTXQRobCPxSnobs_FcLg',
            rowKey: {orgID: 1, issueID: 123},
            row: {
              orgID: 1,
              issueID: 123,
              description: null,
              ['_0_version']: '01',
            },
          },
          {
            stateVersion: '01',
            tableName: 'public.issues',
            op: 's',
            rowKeyHash: 'HFQhV6itMdKyZv81WpOGAg',
            rowKey: {orgID: 1, issueID: 456},
            row: {
              orgID: 1,
              issueID: 456,
              description: null,
              ['_0_version']: '01',
            },
          },
          {
            stateVersion: '01',
            tableName: 'public.issues',
            op: 's',
            rowKeyHash: 'kHZmjyGbDssRKHHEbU2z2g',
            rowKey: {orgID: 2, issueID: 789},
            row: {
              orgID: 2,
              issueID: 789,
              description: null,
              ['_0_version']: '01',
            },
          },
          {
            stateVersion: '02',
            tableName: 'public.issues',
            op: 's',
            rowKeyHash: 'HFQhV6itMdKyZv81WpOGAg',
            rowKey: {orgID: 1, issueID: 456},
            row: {
              orgID: 1,
              issueID: 456,
              description: 'foo',
              ['_0_version']: '02',
            },
          },
          {
            stateVersion: '02',
            tableName: 'public.issues',
            op: 'd',
            rowKeyHash: 'd4LTXQRobCPxSnobs_FcLg',
            rowKey: {orgID: 1, issueID: 123},
            row: null,
          },
          {
            stateVersion: '02',
            tableName: 'public.issues',
            op: 's',
            rowKeyHash: '2qJu-IDPIs7PqBsrtmwZRg',
            rowKey: {orgID: 2, issueID: 123},
            row: {
              orgID: 2,
              issueID: 123,
              description: 'bar',
              ['_0_version']: '02',
            },
          },
        ],
      },
    },
    {
      name: 'delete rows',
      setupUpstream: `
      CREATE TABLE issues(
        "issueID" INTEGER,
        "orgID" INTEGER,
        description TEXT,
        PRIMARY KEY("orgID", "issueID")
      );
      CREATE PUBLICATION zero_all FOR TABLES IN SCHEMA public;
      `,
      setupReplica: `
      CREATE TABLE issues(
        "issueID" INTEGER,
        "orgID" INTEGER,
        description TEXT,
        _0_version VARCHAR(38) DEFAULT '00',
        PRIMARY KEY("orgID", "issueID")
      );
      CREATE PUBLICATION zero_all FOR TABLES IN SCHEMA public;
      `,
      specs: {
        ['public.issues']: {
          schema: 'public',
          name: 'issues',
          columns: {
            issueID: {
              dataType: 'int4',
              characterMaximumLength: null,
              columnDefault: null,
              notNull: true,
            },
            orgID: {
              dataType: 'int4',
              characterMaximumLength: null,
              columnDefault: null,
              notNull: true,
            },
            description: {
              dataType: 'text',
              characterMaximumLength: null,
              columnDefault: null,
              notNull: false,
            },
            ['_0_version']: {
              dataType: 'varchar',
              characterMaximumLength: 38,
              columnDefault: null,
              notNull: true,
            },
          },
          primaryKey: ['orgID', 'issueID'],
        },
      },
      writeUpstream: [
        `
      INSERT INTO issues ("orgID", "issueID") VALUES (1, 123);
      INSERT INTO issues ("orgID", "issueID") VALUES (1, 456);
      INSERT INTO issues ("orgID", "issueID") VALUES (2, 789);
      INSERT INTO issues ("orgID", "issueID") VALUES (2, 987);
      `,
        `
      DELETE FROM issues WHERE "orgID" = 1;
      DELETE FROM issues WHERE "issueID" = 987;
      `,
      ],
      expectedTransactions: 2,
      data: {
        ['public.issues']: [
          {orgID: 2, issueID: 789, description: null, ['_0_version']: '01'},
        ],
        ['_zero.ChangeLog']: [
          {
            stateVersion: '01',
            tableName: 'public.issues',
            op: 's',
            rowKeyHash: 'd4LTXQRobCPxSnobs_FcLg',
            rowKey: {orgID: 1, issueID: 123},
            row: {
              orgID: 1,
              issueID: 123,
              description: null,
              ['_0_version']: '01',
            },
          },
          {
            stateVersion: '01',
            tableName: 'public.issues',
            op: 's',
            rowKeyHash: 'HFQhV6itMdKyZv81WpOGAg',
            rowKey: {orgID: 1, issueID: 456},
            row: {
              orgID: 1,
              issueID: 456,
              description: null,
              ['_0_version']: '01',
            },
          },
          {
            stateVersion: '01',
            tableName: 'public.issues',
            op: 's',
            rowKeyHash: 'kHZmjyGbDssRKHHEbU2z2g',
            rowKey: {orgID: 2, issueID: 789},
            row: {
              orgID: 2,
              issueID: 789,
              description: null,
              ['_0_version']: '01',
            },
          },
          {
            stateVersion: '01',
            tableName: 'public.issues',
            op: 's',
            rowKeyHash: '3TEkNvn8CfoW4xZsp43_Cg',
            rowKey: {orgID: 2, issueID: 987},
            row: {
              orgID: 2,
              issueID: 987,
              description: null,
              ['_0_version']: '01',
            },
          },
          {
            stateVersion: '02',
            tableName: 'public.issues',
            op: 'd',
            rowKeyHash: 'd4LTXQRobCPxSnobs_FcLg',
            rowKey: {orgID: 1, issueID: 123},
            row: null,
          },
          {
            stateVersion: '02',
            tableName: 'public.issues',
            op: 'd',
            rowKeyHash: 'HFQhV6itMdKyZv81WpOGAg',
            rowKey: {orgID: 1, issueID: 456},
            row: null,
          },
          {
            stateVersion: '02',
            tableName: 'public.issues',
            op: 'd',
            rowKeyHash: '3TEkNvn8CfoW4xZsp43_Cg',
            rowKey: {orgID: 2, issueID: 987},
            row: null,
          },
        ],
      },
    },
    {
      name: 'truncate tables',
      setupUpstream: `
      CREATE TABLE foo(id INTEGER PRIMARY KEY);
      CREATE TABLE bar(id INTEGER PRIMARY KEY);
      CREATE TABLE baz(id INTEGER PRIMARY KEY);
      CREATE PUBLICATION zero_all FOR TABLES IN SCHEMA public;
      `,
      setupReplica: `
      CREATE TABLE foo(
        id INTEGER PRIMARY KEY,
        _0_version VARCHAR(38) DEFAULT '00'
      );
      CREATE TABLE bar(
        id INTEGER PRIMARY KEY,
        _0_version VARCHAR(38) DEFAULT '00'
      );
      CREATE TABLE baz(
        id INTEGER PRIMARY KEY,
        _0_version VARCHAR(38) DEFAULT '00'
      );
      CREATE PUBLICATION zero_all FOR TABLES IN SCHEMA public;
      `,
      specs: {
        ['public.foo']: {
          schema: 'public',
          name: 'foo',
          columns: {
            id: {
              dataType: 'int4',
              characterMaximumLength: null,
              columnDefault: null,
              notNull: true,
            },
            ['_0_version']: {
              dataType: 'varchar',
              characterMaximumLength: 38,
              columnDefault: null,
              notNull: true,
            },
          },
          primaryKey: ['id'],
        },
        ['public.bar']: {
          schema: 'public',
          name: 'bar',
          columns: {
            id: {
              dataType: 'int4',
              characterMaximumLength: null,
              columnDefault: null,
              notNull: true,
            },
            ['_0_version']: {
              dataType: 'varchar',
              characterMaximumLength: 38,
              columnDefault: null,
              notNull: true,
            },
          },
          primaryKey: ['id'],
        },
        ['public.baz']: {
          schema: 'public',
          name: 'baz',
          columns: {
            id: {
              dataType: 'int4',
              characterMaximumLength: null,
              columnDefault: null,
              notNull: true,
            },
            ['_0_version']: {
              dataType: 'varchar',
              characterMaximumLength: 38,
              columnDefault: null,
              notNull: true,
            },
          },
          primaryKey: ['id'],
        },
      },
      writeUpstream: [
        `
      INSERT INTO foo (id) VALUES (1);
      INSERT INTO foo (id) VALUES (2);
      INSERT INTO foo (id) VALUES (3);
      INSERT INTO bar (id) VALUES (4);
      INSERT INTO bar (id) VALUES (5);
      INSERT INTO bar (id) VALUES (6);
      INSERT INTO baz (id) VALUES (7);
      INSERT INTO baz (id) VALUES (8);
      INSERT INTO baz (id) VALUES (9);
      TRUNCATE foo, baz;
      TRUNCATE foo;  -- Redundant. Shouldn't cause problems.
      `,
        `
      TRUNCATE foo;
      INSERT INTO foo (id) VALUES (101);
      `,
      ],
      expectedTransactions: 2,
      data: {
        ['public.foo']: [{id: 101, ['_0_version']: '02'}],
        ['public.bar']: [
          {id: 4, ['_0_version']: '01'},
          {id: 5, ['_0_version']: '01'},
          {id: 6, ['_0_version']: '01'},
        ],
        ['public.baz']: [],
        ['_zero.ChangeLog']: [
          {
            stateVersion: '01',
            tableName: 'public.bar',
            op: 's',
            rowKeyHash: 'fa47EdYvwqHKjgDA9ZGxmg',
            rowKey: {id: 4},
            row: {id: 4, ['_0_version']: '01'},
          },
          {
            stateVersion: '01',
            tableName: 'public.bar',
            op: 's',
            rowKeyHash: 'dTBYbmDGWw6O3zYGoshFkA',
            rowKey: {id: 5},
            row: {id: 5, ['_0_version']: '01'},
          },
          {
            stateVersion: '01',
            tableName: 'public.bar',
            op: 's',
            rowKeyHash: 'LQ0Dp-So9WR8sPPTypl-',
            rowKey: {id: 6},
            row: {id: 6, ['_0_version']: '01'},
          },
          {
            stateVersion: '01',
            tableName: 'public.foo',
            op: 't',
            rowKeyHash: '',
            rowKey: null,
            row: null,
          },
          {
            stateVersion: '01',
            tableName: 'public.baz',
            op: 't',
            rowKeyHash: '',
            rowKey: null,
            row: null,
          },
          {
            stateVersion: '02',
            tableName: 'public.foo',
            op: 't',
            rowKeyHash: '',
            rowKey: null,
            row: null,
          },
          {
            stateVersion: '02',
            tableName: 'public.foo',
            op: 's',
            rowKeyHash: 'TNPmtn5B494le1zcxmsLRQ',
            rowKey: {id: 101},
            row: {id: 101, ['_0_version']: '02'},
          },
        ],
      },
    },
    {
      name: 'overwriting updates in the same transaction',
      setupUpstream: `
      CREATE TABLE issues(
        "issueID" INTEGER,
        "orgID" INTEGER,
        description TEXT,
        PRIMARY KEY("orgID", "issueID")
      );
      CREATE PUBLICATION zero_all FOR TABLES IN SCHEMA public;
      `,
      setupReplica: `
      CREATE TABLE issues(
        "issueID" INTEGER,
        "orgID" INTEGER,
        description TEXT,
        _0_version VARCHAR(38) DEFAULT '00',
        PRIMARY KEY("orgID", "issueID")
      );
      CREATE PUBLICATION zero_all FOR TABLES IN SCHEMA public;
      `,
      specs: {
        ['public.issues']: {
          schema: 'public',
          name: 'issues',
          columns: {
            issueID: {
              dataType: 'int4',
              characterMaximumLength: null,
              columnDefault: null,
              notNull: true,
            },
            orgID: {
              dataType: 'int4',
              characterMaximumLength: null,
              columnDefault: null,
              notNull: true,
            },
            description: {
              dataType: 'text',
              characterMaximumLength: null,
              columnDefault: null,
              notNull: false,
            },
            ['_0_version']: {
              dataType: 'varchar',
              characterMaximumLength: 38,
              columnDefault: null,
              notNull: true,
            },
          },
          primaryKey: ['orgID', 'issueID'],
        },
      },
      writeUpstream: [
        `
      INSERT INTO issues ("orgID", "issueID") VALUES (1, 123);
      UPDATE issues SET ("orgID", "issueID") = (1, 456);
      INSERT INTO issues ("orgID", "issueID") VALUES (2, 789);
      DELETE FROM issues WHERE "orgID" = 2;
      UPDATE issues SET "description" = 'foo';
      `,
      ],
      expectedTransactions: 1,
      data: {
        ['public.issues']: [
          {orgID: 1, issueID: 456, description: 'foo', ['_0_version']: '01'},
        ],
        ['_zero.ChangeLog']: [
          {
            stateVersion: '01',
            tableName: 'public.issues',
            op: 'd',
            rowKeyHash: 'kHZmjyGbDssRKHHEbU2z2g',
            rowKey: {orgID: 2, issueID: 789},
            row: null,
          },
          {
            stateVersion: '01',
            tableName: 'public.issues',
            op: 'd',
            rowKeyHash: 'd4LTXQRobCPxSnobs_FcLg',
            rowKey: {orgID: 1, issueID: 123},
            row: null,
          },
          {
            stateVersion: '01',
            tableName: 'public.issues',
            op: 's',
            rowKeyHash: 'HFQhV6itMdKyZv81WpOGAg',
            rowKey: {orgID: 1, issueID: 456},
            row: {
              orgID: 1,
              issueID: 456,
              description: 'foo',
              ['_0_version']: '01',
            },
          },
        ],
      },
    },
  ];

  for (const c of cases) {
    test(c.name, async () => {
      await initDB(upstream, c.setupUpstream);
      await initDB(replica, c.setupReplica);

      const lc = createSilentLogContext();
      await setupUpstream(
        lc,
        'postgresql:///incremental_sync_test_upstream',
        replicationSlot(REPLICA_ID),
      );
      await replica.begin(tx =>
        setupReplicationTables(
          lc,
          REPLICA_ID,
          tx,
          'postgresql:///incremental_sync_test_upstream',
        ),
      );

      const syncing = syncer.start(lc);

      for (const query of c.writeUpstream ?? []) {
        await upstream.unsafe(query);
      }

      let versions: string[] = [];
      if (c.expectedTransactions) {
        // TODO: Replace this with the mechanism that will be used to notify ViewSyncers.
        for (let i = 0; i < 100; i++) {
          const result =
            await replica`SELECT "stateVersion" FROM _zero."TxLog"`.values();
          versions = result.flat();
          expect(versions.length).toBeLessThanOrEqual(c.expectedTransactions);
          if (versions.length === c.expectedTransactions) {
            break;
          }
          // Wait or throw any error from the syncer.
          await Promise.race([sleep(50), syncing]);
        }
      }

      const published = await getPublicationInfo(replica, 'zero_');
      expect(published.tables).toEqual(c.specs);

      await expectTables(replica, replaceVersions(c.data, versions));
    });
  }

  function replaceVersions(
    data: Record<string, Record<string, unknown>[]>,
    versions: string[],
  ): Record<string, unknown[]> {
    const replace = (key: string, obj: Record<string, unknown>) => {
      const v = obj[key] as LexiVersion;
      const index = Number(versionFromLexi(v));
      if (index > 0) {
        obj[key] = versions[index - 1];
      }
    };
    Object.values(data).forEach(table =>
      table.forEach(row => {
        for (const col of ['_0_version', 'stateVersion']) {
          if (col in row) {
            replace(col, row);
          }
        }
        for (const val of Object.values(row)) {
          if (val !== null && typeof val === 'object' && '_0_version' in val) {
            replace('_0_version', val);
          }
        }
      }),
    );
    return data;
  }
});