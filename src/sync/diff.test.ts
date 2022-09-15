import {expect} from '@esm-bundle/chai';
import type {InternalDiff} from '../btree/node.js';
import * as dag from '../dag/mod';
import {diff} from './diff.js';
import {
  addGenesis,
  addIndexChange,
  addLocal,
  addSnapshot,
  Chain,
} from '../db/test-helpers';

type DiffsRecord = Record<string, InternalDiff>;

test('db diff', async () => {
  const store = new dag.TestStore();
  const clientID = 'client-id-1';
  const chain: Chain = [];
  await addGenesis(chain, store, clientID);
  await addLocal(chain, store, clientID, [['a', 'a2']]);
  await addLocal(chain, store, clientID, [['b', 'b1']]);

  const t = async (iOld: number, iNew: number, expectedDiff: DiffsRecord) => {
    await store.withRead(async read => {
      const diffsMap = await diff(
        chain[iOld].chunk.hash,
        chain[iNew].chunk.hash,
        read,
      );
      expect(Object.fromEntries(diffsMap)).to.deep.equal(expectedDiff);
    });
  };

  await t(0, 1, {
    '': [
      {
        key: 'a',
        newValue: 'a2',
        op: 'add',
      },
    ],
  });

  await t(0, 2, {
    '': [
      {
        key: 'a',
        newValue: 'a2',
        op: 'add',
      },
      {key: 'b', newValue: 'b1', op: 'add'},
    ],
  });

  await t(1, 2, {
    '': [{key: 'b', newValue: 'b1', op: 'add'}],
  });

  await t(0, 0, {});

  if (DD31) {
    await addSnapshot(chain, store, [], clientID, undefined, undefined, {
      'index-c': {prefix: 'c', jsonPointer: ''},
    });
    await addLocal(chain, store, clientID, [
      ['c1', 'c1'],
      ['c2', 'c2'],
    ]);

    await t(chain.length - 2, chain.length - 1, {
      '': [
        {
          key: 'c1',
          newValue: 'c1',
          op: 'add',
        },
        {
          key: 'c2',
          newValue: 'c2',
          op: 'add',
        },
      ],
      'index-c': [
        {
          key: '\u0000c1\u0000c1',
          newValue: 'c1',
          op: 'add',
        },
        {
          key: '\u0000c2\u0000c2',
          newValue: 'c2',
          op: 'add',
        },
      ],
    });
  } else {
    await addSnapshot(
      chain,
      store,
      [
        ['c1', 'c1'],
        ['c2', 'c2'],
      ],
      clientID,
    );
    await addIndexChange(chain, store, clientID, 'index-c', {
      prefix: 'c',
      jsonPointer: '',
    });

    await t(chain.length - 2, chain.length - 1, {
      'index-c': [
        {
          key: '\u0000c1\u0000c1',
          newValue: 'c1',
          op: 'add',
        },
        {
          key: '\u0000c2\u0000c2',
          newValue: 'c2',
          op: 'add',
        },
      ],
    });
  }

  await addLocal(chain, store, clientID, [['c1', 'c1-new']]);
  await t(chain.length - 2, chain.length - 1, {
    '': [
      {
        key: 'c1',
        newValue: 'c1-new',
        oldValue: 'c1',
        op: 'change',
      },
    ],
    'index-c': [
      {
        key: '\u0000c1\u0000c1',
        oldValue: 'c1',
        op: 'del',
      },
      {
        key: '\u0000c1-new\u0000c1',
        newValue: 'c1-new',
        op: 'add',
      },
    ],
  });

  if (DD31) {
    await t(chain.length - 3, chain.length - 1, {
      '': [
        {
          key: 'c1',
          newValue: 'c1-new',
          op: 'add',
        },
        {
          key: 'c2',
          newValue: 'c2',
          op: 'add',
        },
      ],
      'index-c': [
        {
          key: '\u0000c1-new\u0000c1',
          newValue: 'c1-new',
          op: 'add',
        },
        {
          key: '\u0000c2\u0000c2',
          newValue: 'c2',
          op: 'add',
        },
      ],
    });
  } else {
    await t(chain.length - 3, chain.length - 1, {
      '': [
        {
          key: 'c1',
          newValue: 'c1-new',
          oldValue: 'c1',
          op: 'change',
        },
      ],
      'index-c': [
        {
          key: '\u0000c1-new\u0000c1',
          newValue: 'c1-new',
          op: 'add',
        },
        {
          key: '\u0000c2\u0000c2',
          newValue: 'c2',
          op: 'add',
        },
      ],
    });
  }
});
