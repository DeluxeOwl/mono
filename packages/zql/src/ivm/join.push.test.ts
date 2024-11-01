import {describe, expect, suite, test} from 'vitest';
import {assert} from '../../../shared/src/asserts.js';
import type {JSONObject} from '../../../shared/src/json.js';
import {must} from '../../../shared/src/must.js';
import type {Ordering} from '../../../zero-protocol/src/ast.js';
import type {Row} from '../../../zero-protocol/src/data.js';
import type {PrimaryKey} from '../../../zero-protocol/src/primary-key.js';
import {ArrayView} from './array-view.js';
import {Catch} from './catch.js';
import type {Change} from './change.js';
import type {NormalizedValue} from './data.js';
import {Join, createPrimaryKeySetStorageKey} from './join.js';
import {MemorySource} from './memory-source.js';
import {MemoryStorage} from './memory-storage.js';
import type {Input} from './operator.js';
import type {SchemaValue} from './schema.js';
import {Snitch, type SnitchMessage} from './snitch.js';
import type {SourceChange} from './source.js';
import type {Format} from './view.js';

suite('push one:many', () => {
  const base = {
    columns: [
      {id: {type: 'string'}},
      {id: {type: 'string'}, issueID: {type: 'string'}},
    ],
    primaryKeys: [['id'], ['id']],
    joins: [
      {
        parentKey: 'id',
        childKey: 'issueID',
        relationshipName: 'comments',
      },
    ],
  } as const;

  pushTest({
    ...base,
    name: 'fetch one parent, remove parent',
    sources: [[{id: 'i1'}], []],
    pushes: [[0, {type: 'remove', row: {id: 'i1'}}]],
    expectedLog: [
      ['0', 'push', {type: 'remove', row: {id: 'i1'}}],
      ['1', 'cleanup', {constraint: {key: 'issueID', value: 'i1'}}],
    ],
    expectedPrimaryKeySetStorageKeys: [[]],
    expectedOutput: [
      {
        type: 'remove',
        node: {
          row: {
            id: 'i1',
          },
          relationships: {
            comments: [],
          },
        },
      },
    ],
  });

  pushTest({
    ...base,
    name: 'fetch one child, remove child',
    sources: [[], [{id: 'c1', issueID: 'i1'}]],
    pushes: [[1, {type: 'remove', row: {id: 'c1', issueID: 'i1'}}]],
    expectedLog: [
      ['1', 'push', {type: 'remove', row: {id: 'c1', issueID: 'i1'}}],
      ['0', 'fetch', {constraint: {key: 'id', value: 'i1'}}],
    ],
    expectedPrimaryKeySetStorageKeys: [[]],
    expectedOutput: [],
  });

  pushTest({
    ...base,
    name: 'fetch one child, add parent',
    sources: [[], [{id: 'c1', issueID: 'i1'}]],
    pushes: [[0, {type: 'add', row: {id: 'i1'}}]],
    expectedLog: [
      ['0', 'push', {type: 'add', row: {id: 'i1'}}],
      ['1', 'fetch', {constraint: {key: 'issueID', value: 'i1'}}],
    ],
    expectedPrimaryKeySetStorageKeys: [[['i1', 'i1']]],
    expectedOutput: [
      {
        type: 'add',
        node: {
          row: {
            id: 'i1',
          },
          relationships: {
            comments: [{row: {id: 'c1', issueID: 'i1'}, relationships: {}}],
          },
        },
      },
    ],
  });

  pushTest({
    ...base,
    name: 'fetch two children, add parent',
    sources: [
      [],
      [
        {id: 'c1', issueID: 'i1'},
        {id: 'c2', issueID: 'i1'},
      ],
    ],
    pushes: [[0, {type: 'add', row: {id: 'i1'}}]],
    expectedLog: [
      ['0', 'push', {type: 'add', row: {id: 'i1'}}],
      ['1', 'fetch', {constraint: {key: 'issueID', value: 'i1'}}],
    ],
    expectedPrimaryKeySetStorageKeys: [[['i1', 'i1']]],
    expectedOutput: [
      {
        type: 'add',
        node: {
          row: {
            id: 'i1',
          },
          relationships: {
            comments: [
              {row: {id: 'c1', issueID: 'i1'}, relationships: {}},
              {row: {id: 'c2', issueID: 'i1'}, relationships: {}},
            ],
          },
        },
      },
    ],
  });

  pushTest({
    ...base,
    name: 'fetch one child, add wrong parent',
    sources: [[], [{id: 'c1', issueID: 'i1'}]],
    pushes: [[0, {type: 'add', row: {id: 'i2'}}]],
    expectedLog: [
      ['0', 'push', {type: 'add', row: {id: 'i2'}}],
      ['1', 'fetch', {constraint: {key: 'issueID', value: 'i2'}}],
    ],
    expectedPrimaryKeySetStorageKeys: [[['i2', 'i2']]],
    expectedOutput: [
      {
        type: 'add',
        node: {
          row: {
            id: 'i2',
          },
          relationships: {
            comments: [],
          },
        },
      },
    ],
  });

  pushTest({
    ...base,
    name: 'fetch one parent, add child',
    sources: [[{id: 'i1'}], []],
    pushes: [[1, {type: 'add', row: {id: 'c1', issueID: 'i1'}}]],
    expectedLog: [
      ['1', 'push', {type: 'add', row: {id: 'c1', issueID: 'i1'}}],
      ['0', 'fetch', {constraint: {key: 'id', value: 'i1'}}],
    ],
    expectedPrimaryKeySetStorageKeys: [[['i1', 'i1']]],
    expectedOutput: [
      {
        type: 'child',
        row: {
          id: 'i1',
        },
        child: {
          relationshipName: 'comments',
          change: {
            type: 'add',
            node: {
              row: {
                id: 'c1',
                issueID: 'i1',
              },
              relationships: {},
            },
          },
        },
      },
    ],
  });

  pushTest({
    ...base,
    name: 'fetch one parent, add wrong child',
    sources: [[{id: 'i1'}], []],
    pushes: [[1, {type: 'add', row: {id: 'c1', issueID: 'i2'}}]],
    expectedLog: [
      ['1', 'push', {type: 'add', row: {id: 'c1', issueID: 'i2'}}],
      ['0', 'fetch', {constraint: {key: 'id', value: 'i2'}}],
    ],
    expectedPrimaryKeySetStorageKeys: [[['i1', 'i1']]],
    expectedOutput: [],
  });

  pushTest({
    ...base,
    name: 'fetch one parent, one child, remove parent',
    sources: [[{id: 'i1'}], [{id: 'c1', issueID: 'i1'}]],
    pushes: [[0, {type: 'remove', row: {id: 'i1'}}]],
    expectedLog: [
      ['0', 'push', {type: 'remove', row: {id: 'i1'}}],
      ['1', 'cleanup', {constraint: {key: 'issueID', value: 'i1'}}],
    ],
    expectedPrimaryKeySetStorageKeys: [[]],
    expectedOutput: [
      {
        type: 'remove',
        node: {
          row: {
            id: 'i1',
          },
          relationships: {
            comments: [{row: {id: 'c1', issueID: 'i1'}, relationships: {}}],
          },
        },
      },
    ],
  });

  pushTest({
    ...base,
    name: 'fetch one parent, two children, remove parent',
    sources: [
      [{id: 'i1'}],
      [
        {id: 'c1', issueID: 'i1'},
        {id: 'c2', issueID: 'i1'},
      ],
    ],
    pushes: [[0, {type: 'remove', row: {id: 'i1'}}]],
    expectedLog: [
      ['0', 'push', {type: 'remove', row: {id: 'i1'}}],
      ['1', 'cleanup', {constraint: {key: 'issueID', value: 'i1'}}],
    ],
    expectedPrimaryKeySetStorageKeys: [[]],
    expectedOutput: [
      {
        type: 'remove',
        node: {
          row: {
            id: 'i1',
          },
          relationships: {
            comments: [
              {row: {id: 'c1', issueID: 'i1'}, relationships: {}},
              {row: {id: 'c2', issueID: 'i1'}, relationships: {}},
            ],
          },
        },
      },
    ],
  });

  pushTest({
    ...base,
    name: 'no fetch, add parent, add child, add child, remove child, remove parent',
    sources: [[], []],
    pushes: [
      [0, {type: 'add', row: {id: 'i1'}}],
      [1, {type: 'add', row: {id: 'c1', issueID: 'i1'}}],
      [1, {type: 'add', row: {id: 'c2', issueID: 'i1'}}],
      [1, {type: 'remove', row: {id: 'c1', issueID: 'i1'}}],
      [0, {type: 'remove', row: {id: 'i1'}}],
    ],
    expectedLog: [
      ['0', 'push', {type: 'add', row: {id: 'i1'}}],
      ['1', 'fetch', {constraint: {key: 'issueID', value: 'i1'}}],
      ['1', 'push', {type: 'add', row: {id: 'c1', issueID: 'i1'}}],
      ['0', 'fetch', {constraint: {key: 'id', value: 'i1'}}],
      ['1', 'push', {type: 'add', row: {id: 'c2', issueID: 'i1'}}],
      ['0', 'fetch', {constraint: {key: 'id', value: 'i1'}}],
      ['1', 'push', {type: 'remove', row: {id: 'c1', issueID: 'i1'}}],
      ['0', 'fetch', {constraint: {key: 'id', value: 'i1'}}],
      ['0', 'push', {type: 'remove', row: {id: 'i1'}}],
      ['1', 'cleanup', {constraint: {key: 'issueID', value: 'i1'}}],
    ],
    expectedPrimaryKeySetStorageKeys: [[], []],
    expectedOutput: [
      {
        type: 'add',
        node: {
          row: {
            id: 'i1',
          },
          relationships: {
            comments: [],
          },
        },
      },
      {
        type: 'child',
        row: {
          id: 'i1',
        },
        child: {
          relationshipName: 'comments',
          change: {
            type: 'add',
            node: {
              row: {
                id: 'c1',
                issueID: 'i1',
              },
              relationships: {},
            },
          },
        },
      },
      {
        type: 'child',
        row: {
          id: 'i1',
        },
        child: {
          relationshipName: 'comments',
          change: {
            type: 'add',
            node: {
              row: {
                id: 'c2',
                issueID: 'i1',
              },
              relationships: {},
            },
          },
        },
      },
      {
        type: 'child',
        row: {
          id: 'i1',
        },
        child: {
          relationshipName: 'comments',
          change: {
            type: 'remove',
            node: {
              row: {
                id: 'c1',
                issueID: 'i1',
              },
              relationships: {},
            },
          },
        },
      },
      {
        type: 'remove',
        node: {
          row: {
            id: 'i1',
          },
          relationships: {
            comments: [{row: {id: 'c2', issueID: 'i1'}, relationships: {}}],
          },
        },
      },
    ],
  });

  suite('edit', () => {
    const base = {
      columns: [
        {id: {type: 'string'}, text: {type: 'string'}},
        {
          id: {type: 'string'},
          issueID: {type: 'string'},
          text: {type: 'string'},
        },
      ],
      primaryKeys: [['id'], ['id']],
      joins: [
        {
          parentKey: 'id',
          childKey: 'issueID',
          relationshipName: 'comments',
        },
      ],
    } as const;

    pushTest({
      ...base,
      name: 'edit issue text',
      sources: [
        [{id: 'i1', text: 'issue 1'}],
        [
          {id: 'c1', issueID: 'i1', text: 'comment 1'},
          {id: 'c2', issueID: 'i1', text: 'comment 2'},
        ],
      ],
      pushes: [
        [
          0,
          {
            type: 'edit',
            oldRow: {id: 'i1', text: 'issue 1'},
            row: {id: 'i1', text: 'issue 1 edited'},
          },
        ],
      ],
      expectedLog: [
        [
          '0',
          'push',
          {
            type: 'edit',
            oldRow: {id: 'i1', text: 'issue 1'},
            row: {id: 'i1', text: 'issue 1 edited'},
          },
        ],
      ],
      expectedPrimaryKeySetStorageKeys: [[['i1', 'i1']]],
      expectedOutput: [
        {
          type: 'edit',
          row: {
            id: 'i1',
            text: 'issue 1 edited',
          },
          oldRow: {
            id: 'i1',
            text: 'issue 1',
          },
        },
      ],
    });

    pushTest({
      ...base,
      name: 'edit comment text',
      sources: [
        [{id: 'i1', text: 'issue 1'}],
        [
          {id: 'c1', issueID: 'i1', text: 'comment 1'},
          {id: 'c2', issueID: 'i1', text: 'comment 2'},
        ],
      ],
      pushes: [
        [
          1,
          {
            type: 'edit',
            oldRow: {id: 'c1', issueID: 'i1', text: 'comment 1'},
            row: {id: 'c1', issueID: 'i1', text: 'comment 1 edited'},
          },
        ],
      ],
      expectedLog: [
        [
          '1',
          'push',
          {
            type: 'edit',
            oldRow: {id: 'c1', issueID: 'i1', text: 'comment 1'},
            row: {id: 'c1', issueID: 'i1', text: 'comment 1 edited'},
          },
        ],
        ['0', 'fetch', {constraint: {key: 'id', value: 'i1'}}],
      ],
      expectedPrimaryKeySetStorageKeys: [[['i1', 'i1']]],
      expectedOutput: [
        {
          type: 'child',
          row: {
            id: 'i1',
            text: 'issue 1',
          },
          child: {
            change: {
              oldRow: {
                id: 'c1',
                issueID: 'i1',
                text: 'comment 1',
              },
              row: {
                id: 'c1',
                issueID: 'i1',
                text: 'comment 1 edited',
              },
              type: 'edit',
            },
            relationshipName: 'comments',
          },
        },
      ],
    });

    pushTest({
      ...base,
      name: 'edit issueID of comment',
      sources: [
        [
          {id: 'i1', text: 'issue 1'},
          {id: 'i2', text: 'issue 2'},
        ],
        [
          {id: 'c1', issueID: 'i1', text: 'comment 1'},
          {id: 'c2', issueID: 'i1', text: 'comment 2'},
        ],
      ],
      pushes: [
        [
          1,
          {
            type: 'edit',
            oldRow: {id: 'c1', issueID: 'i1', text: 'comment 1'},
            row: {id: 'c1', issueID: 'i2', text: 'comment 1.2'},
          },
        ],
      ],
      expectedLog: [
        [
          '1',
          'push',
          {
            type: 'edit',
            oldRow: {id: 'c1', issueID: 'i1', text: 'comment 1'},
            row: {id: 'c1', issueID: 'i2', text: 'comment 1.2'},
          },
        ],
        ['1', 'fetch', {constraint: {key: 'issueID', value: 'i1'}}],
        ['0', 'fetch', {constraint: {key: 'id', value: 'i1'}}],
        ['0', 'fetch', {constraint: {key: 'id', value: 'i2'}}],
      ],
      expectedPrimaryKeySetStorageKeys: [
        [
          ['i1', 'i1'],
          ['i2', 'i2'],
        ],
      ],
      expectedOutput: [
        {
          type: 'child',
          row: {
            id: 'i1',
            text: 'issue 1',
          },
          child: {
            change: {
              type: 'remove',
              node: {
                row: {
                  id: 'c1',
                  issueID: 'i1',
                  text: 'comment 1',
                },
                relationships: {},
              },
            },
            relationshipName: 'comments',
          },
        },
        {
          type: 'child',
          row: {
            id: 'i2',
            text: 'issue 2',
          },
          child: {
            change: {
              type: 'add',
              node: {
                row: {
                  id: 'c1',
                  issueID: 'i2',
                  text: 'comment 1.2',
                },
                relationships: {},
              },
            },
            relationshipName: 'comments',
          },
        },
      ],
    });

    pushTest({
      ...base,
      name: 'edit id of issue',
      sources: [
        [
          {id: 'i1', text: 'issue 1'},
          {id: 'i2', text: 'issue 2'},
        ],
        [
          {id: 'c1', issueID: 'i1', text: 'comment 1'},
          {id: 'c2', issueID: 'i2', text: 'comment 2'},
          {id: 'c3', issueID: 'i3', text: 'comment 3'},
        ],
      ],
      pushes: [
        [
          0,
          {
            type: 'edit',
            oldRow: {id: 'i1', text: 'issue 1'},
            row: {id: 'i3', text: 'issue 1.3'},
          },
        ],
      ],
      expectedLog: [
        [
          '0',
          'push',
          {
            type: 'edit',
            oldRow: {id: 'i1', text: 'issue 1'},
            row: {id: 'i3', text: 'issue 1.3'},
          },
        ],
        ['1', 'cleanup', {constraint: {key: 'issueID', value: 'i1'}}],
        ['1', 'fetch', {constraint: {key: 'issueID', value: 'i3'}}],
      ],
      expectedPrimaryKeySetStorageKeys: [
        [
          ['i2', 'i2'],
          ['i3', 'i3'],
        ],
      ],
      expectedOutput: [
        {
          type: 'edit',
          oldRow: {
            id: 'i1',
            text: 'issue 1',
          },
          row: {
            id: 'i3',
            text: 'issue 1.3',
          },
        },
        {
          type: 'child',
          child: {
            change: {
              type: 'remove',
              node: {
                row: {
                  id: 'c1',
                  issueID: 'i1',
                  text: 'comment 1',
                },
                relationships: {},
              },
            },
            relationshipName: 'comments',
          },
          row: {
            id: 'i3',
            text: 'issue 1.3',
          },
        },
        {
          type: 'child',
          child: {
            change: {
              node: {
                relationships: {},
                row: {
                  id: 'c3',
                  issueID: 'i3',
                  text: 'comment 3',
                },
              },
              type: 'add',
            },
            relationshipName: 'comments',
          },
          row: {
            id: 'i3',
            text: 'issue 1.3',
          },
        },
      ],
    });
  });
});

suite('push many:one', () => {
  const base = {
    columns: [
      {id: {type: 'string'}, ownerID: {type: 'string'}},
      {id: {type: 'string'}},
    ],
    primaryKeys: [['id'], ['id']],
    joins: [
      {
        parentKey: 'ownerID',
        childKey: 'id',
        relationshipName: 'owner',
      },
    ],
  } as const;

  pushTest({
    ...base,
    name: 'fetch one child, add parent',
    sources: [[], [{id: 'u1'}]],
    pushes: [[0, {type: 'add', row: {id: 'i1', ownerID: 'u1'}}]],
    expectedLog: [
      ['0', 'push', {type: 'add', row: {id: 'i1', ownerID: 'u1'}}],
      ['1', 'fetch', {constraint: {key: 'id', value: 'u1'}}],
    ],
    expectedPrimaryKeySetStorageKeys: [[['u1', 'i1']]],
    expectedOutput: [
      {
        type: 'add',
        node: {
          row: {
            id: 'i1',
            ownerID: 'u1',
          },
          relationships: {
            owner: [{row: {id: 'u1'}, relationships: {}}],
          },
        },
      },
    ],
  });

  pushTest({
    ...base,
    name: 'fetch one child, add wrong parent',
    sources: [[], [{id: 'u1'}]],
    pushes: [[0, {type: 'add', row: {id: 'i1', ownerID: 'u2'}}]],
    expectedLog: [
      ['0', 'push', {type: 'add', row: {id: 'i1', ownerID: 'u2'}}],
      ['1', 'fetch', {constraint: {key: 'id', value: 'u2'}}],
    ],
    expectedPrimaryKeySetStorageKeys: [[['u2', 'i1']]],
    expectedOutput: [
      {
        type: 'add',
        node: {
          row: {
            id: 'i1',
            ownerID: 'u2',
          },
          relationships: {
            owner: [],
          },
        },
      },
    ],
  });

  pushTest({
    ...base,
    name: 'fetch one parent, add child',
    sources: [[{id: 'i1', ownerID: 'u1'}], []],
    pushes: [[1, {type: 'add', row: {id: 'u1'}}]],
    expectedLog: [
      ['1', 'push', {type: 'add', row: {id: 'u1'}}],
      ['0', 'fetch', {constraint: {key: 'ownerID', value: 'u1'}}],
    ],
    expectedPrimaryKeySetStorageKeys: [[['u1', 'i1']]],
    expectedOutput: [
      {
        type: 'child',
        row: {
          id: 'i1',
          ownerID: 'u1',
        },
        child: {
          relationshipName: 'owner',
          change: {
            type: 'add',
            node: {
              row: {
                id: 'u1',
              },
              relationships: {},
            },
          },
        },
      },
    ],
  });

  pushTest({
    ...base,
    name: 'fetch two parents, add one child',
    sources: [
      [
        {id: 'i1', ownerID: 'u1'},
        {id: 'i2', ownerID: 'u1'},
      ],
      [],
    ],
    pushes: [[1, {type: 'add', row: {id: 'u1'}}]],
    expectedLog: [
      ['1', 'push', {type: 'add', row: {id: 'u1'}}],
      ['0', 'fetch', {constraint: {key: 'ownerID', value: 'u1'}}],
    ],
    expectedPrimaryKeySetStorageKeys: [
      [
        ['u1', 'i1'],
        ['u1', 'i2'],
      ],
    ],
    expectedOutput: [
      {
        type: 'child',
        row: {
          id: 'i1',
          ownerID: 'u1',
        },
        child: {
          relationshipName: 'owner',
          change: {
            type: 'add',
            node: {
              row: {
                id: 'u1',
              },
              relationships: {},
            },
          },
        },
      },
      {
        type: 'child',
        row: {
          id: 'i2',
          ownerID: 'u1',
        },
        child: {
          relationshipName: 'owner',
          change: {
            type: 'add',
            node: {
              row: {
                id: 'u1',
              },
              relationships: {},
            },
          },
        },
      },
    ],
  });

  suite('edit', () => {
    const base = {
      columns: [
        {
          id: {type: 'string'},
          ownerID: {type: 'string'},
          text: {type: 'string'},
        },
        {id: {type: 'string'}, text: {type: 'string'}},
      ],
      primaryKeys: [['id'], ['id']],
      joins: [
        {
          parentKey: 'ownerID',
          childKey: 'id',
          relationshipName: 'owner',
        },
      ],
    } as const;

    pushTest({
      ...base,
      name: 'edit child to make it match to parents',
      sources: [
        [
          {id: 'i1', ownerID: 'u1', text: 'item 1'},
          {id: 'i2', ownerID: 'u1', text: 'item 2'},
        ],
        [{id: 'u2', text: 'user 2'}],
      ],
      pushes: [
        [
          1,
          {
            type: 'edit',
            row: {id: 'u1', text: 'user 1'},
            oldRow: {id: 'u2', text: 'user 2'},
          },
        ],
      ],
      expectedLog: [
        [
          '1',
          'push',
          {
            type: 'edit',
            row: {id: 'u1', text: 'user 1'},
            oldRow: {id: 'u2', text: 'user 2'},
          },
        ],
        ['1', 'fetch', {constraint: {key: 'id', value: 'u2'}}],
        ['0', 'fetch', {constraint: {key: 'ownerID', value: 'u2'}}],
        ['0', 'fetch', {constraint: {key: 'ownerID', value: 'u1'}}],
      ],
      expectedPrimaryKeySetStorageKeys: [
        [
          ['u1', 'i1'],
          ['u1', 'i2'],
        ],
      ],
      expectedOutput: [
        {
          type: 'child',
          row: {
            id: 'i1',
            ownerID: 'u1',
            text: 'item 1',
          },
          child: {
            relationshipName: 'owner',
            change: {
              type: 'add',
              node: {
                row: {
                  id: 'u1',
                  text: 'user 1',
                },
                relationships: {},
              },
            },
          },
        },
        {
          type: 'child',
          row: {
            id: 'i2',
            ownerID: 'u1',
            text: 'item 2',
          },
          child: {
            relationshipName: 'owner',
            change: {
              type: 'add',
              node: {
                row: {
                  id: 'u1',
                  text: 'user 1',
                },
                relationships: {},
              },
            },
          },
        },
      ],
    });

    pushTest({
      ...base,
      name: 'edit non matching child',
      sources: [
        [
          {id: 'i1', ownerID: 'u1', text: 'item 1'},
          {id: 'i2', ownerID: 'u1', text: 'item 2'},
        ],
        [{id: 'u2', text: 'user 2'}],
      ],
      pushes: [
        [
          1,
          {
            type: 'edit',
            row: {id: 'u2', text: 'user 2 changed'},
            oldRow: {id: 'u2', text: 'user 2'},
          },
        ],
      ],
      expectedLog: [
        [
          '1',
          'push',
          {
            type: 'edit',
            row: {id: 'u2', text: 'user 2 changed'},
            oldRow: {id: 'u2', text: 'user 2'},
          },
        ],
        ['0', 'fetch', {constraint: {key: 'ownerID', value: 'u2'}}],
      ],
      expectedPrimaryKeySetStorageKeys: [
        [
          ['u1', 'i1'],
          ['u1', 'i2'],
        ],
      ],
      expectedOutput: [],
    });

    pushTest({
      ...base,
      name: 'edit matching child',
      sources: [
        [
          {id: 'i1', ownerID: 'u1', text: 'item 1'},
          {id: 'i2', ownerID: 'u1', text: 'item 2'},
        ],
        [{id: 'u1', text: 'user 1'}],
      ],
      pushes: [
        [
          1,
          {
            type: 'edit',
            row: {id: 'u1', text: 'user 1 changed'},
            oldRow: {id: 'u1', text: 'user 1'},
          },
        ],
      ],
      expectedLog: [
        [
          '1',
          'push',
          {
            type: 'edit',
            row: {id: 'u1', text: 'user 1 changed'},
            oldRow: {id: 'u1', text: 'user 1'},
          },
        ],
        ['0', 'fetch', {constraint: {key: 'ownerID', value: 'u1'}}],
      ],
      expectedPrimaryKeySetStorageKeys: [
        [
          ['u1', 'i1'],
          ['u1', 'i2'],
        ],
      ],
      expectedOutput: [
        {
          type: 'child',
          row: {
            id: 'i1',
            ownerID: 'u1',
            text: 'item 1',
          },
          child: {
            change: {
              type: 'edit',
              oldRow: {
                id: 'u1',
                text: 'user 1',
              },
              row: {
                id: 'u1',
                text: 'user 1 changed',
              },
            },
            relationshipName: 'owner',
          },
        },
        {
          type: 'child',
          row: {
            id: 'i2',
            ownerID: 'u1',
            text: 'item 2',
          },
          child: {
            change: {
              type: 'edit',
              oldRow: {
                id: 'u1',
                text: 'user 1',
              },
              row: {
                id: 'u1',
                text: 'user 1 changed',
              },
            },
            relationshipName: 'owner',
          },
        },
      ],
    });
  });
});

suite('push one:many:many', () => {
  const base = {
    columns: [
      {id: {type: 'string'}},
      {id: {type: 'string'}, issueID: {type: 'string'}},
      {id: {type: 'string'}, labelID: {type: 'string'}},
    ],
    primaryKeys: [['id'], ['id'], ['id']],
    joins: [
      {
        parentKey: 'id',
        childKey: 'issueID',
        relationshipName: 'comments',
      },
      {
        parentKey: 'id',
        childKey: 'commentID',
        relationshipName: 'revisions',
      },
    ],
  } as const;

  pushTest({
    ...base,
    name: 'fetch one parent, one child, add grandchild',
    sources: [[{id: 'i1'}], [{id: 'c1', issueID: 'i1'}], []],
    pushes: [[2, {type: 'add', row: {id: 'r1', commentID: 'c1'}}]],
    expectedLog: [
      ['2', 'push', {type: 'add', row: {id: 'r1', commentID: 'c1'}}],
      ['1', 'fetch', {constraint: {key: 'id', value: 'c1'}}],
      ['0', 'fetch', {constraint: {key: 'id', value: 'i1'}}],
    ],
    expectedPrimaryKeySetStorageKeys: [[['i1', 'i1']], [['c1', 'c1']]],
    expectedOutput: [
      {
        type: 'child',
        row: {
          id: 'i1',
        },
        child: {
          relationshipName: 'comments',
          change: {
            type: 'child',
            row: {
              id: 'c1',
              issueID: 'i1',
            },
            child: {
              relationshipName: 'revisions',
              change: {
                type: 'add',
                node: {
                  row: {
                    id: 'r1',
                    commentID: 'c1',
                  },
                  relationships: {},
                },
              },
            },
          },
        },
      },
    ],
  });

  pushTest({
    ...base,
    name: 'fetch one parent, one grandchild, add child',
    sources: [[{id: 'i1'}], [], [{id: 'r1', commentID: 'c1'}]],
    pushes: [[1, {type: 'add', row: {id: 'c1', issueID: 'i1'}}]],
    expectedLog: [
      ['1', 'push', {type: 'add', row: {id: 'c1', issueID: 'i1'}}],
      ['2', 'fetch', {constraint: {key: 'commentID', value: 'c1'}}],
      ['0', 'fetch', {constraint: {key: 'id', value: 'i1'}}],
    ],
    expectedPrimaryKeySetStorageKeys: [[['i1', 'i1']], [['c1', 'c1']]],
    expectedOutput: [
      {
        type: 'child',
        row: {
          id: 'i1',
        },
        child: {
          relationshipName: 'comments',
          change: {
            type: 'add',
            node: {
              row: {
                id: 'c1',
                issueID: 'i1',
              },
              relationships: {
                revisions: [
                  {row: {id: 'r1', commentID: 'c1'}, relationships: {}},
                ],
              },
            },
          },
        },
      },
    ],
  });

  pushTest({
    ...base,
    name: 'fetch one child, one grandchild, add parent',
    sources: [[], [{id: 'c1', issueID: 'i1'}], [{id: 'r1', commentID: 'c1'}]],
    pushes: [[0, {type: 'add', row: {id: 'i1'}}]],
    expectedLog: [
      ['0', 'push', {type: 'add', row: {id: 'i1'}}],
      ['1', 'fetch', {constraint: {key: 'issueID', value: 'i1'}}],
      ['2', 'fetch', {constraint: {key: 'commentID', value: 'c1'}}],
    ],
    expectedPrimaryKeySetStorageKeys: [[['i1', 'i1']], [['c1', 'c1']]],
    expectedOutput: [
      {
        type: 'add',
        node: {
          row: {
            id: 'i1',
          },
          relationships: {
            comments: [
              {
                row: {id: 'c1', issueID: 'i1'},
                relationships: {
                  revisions: [
                    {row: {id: 'r1', commentID: 'c1'}, relationships: {}},
                  ],
                },
              },
            ],
          },
        },
      },
    ],
  });

  pushTest({
    ...base,
    name: 'fetch one parent, one child, one grandchild, remove parent',
    sources: [
      [{id: 'i1'}],
      [{id: 'c1', issueID: 'i1'}],
      [{id: 'r1', commentID: 'c1'}],
    ],
    pushes: [[0, {type: 'remove', row: {id: 'i1'}}]],
    expectedLog: [
      ['0', 'push', {type: 'remove', row: {id: 'i1'}}],
      ['1', 'cleanup', {constraint: {key: 'issueID', value: 'i1'}}],
      ['2', 'cleanup', {constraint: {key: 'commentID', value: 'c1'}}],
    ],
    expectedPrimaryKeySetStorageKeys: [[], []],
    expectedOutput: [
      {
        type: 'remove',
        node: {
          row: {
            id: 'i1',
          },
          relationships: {
            comments: [
              {
                row: {id: 'c1', issueID: 'i1'},
                relationships: {
                  revisions: [
                    {row: {id: 'r1', commentID: 'c1'}, relationships: {}},
                  ],
                },
              },
            ],
          },
        },
      },
    ],
  });
});

suite('push one:many:one', () => {
  const base = {
    columns: [
      {id: {type: 'string'}},
      {issueID: {type: 'string'}, labelID: {type: 'string'}},
      {id: {type: 'string'}},
    ],
    primaryKeys: [['id'], ['issueID', 'labelID'], ['id']],
    joins: [
      {
        parentKey: 'id',
        childKey: 'issueID',
        relationshipName: 'issuelabels',
      },
      {
        parentKey: 'labelID',
        childKey: 'id',
        relationshipName: 'labels',
      },
    ],
  } as const;

  const sorts = {
    1: [
      ['issueID', 'asc'],
      ['labelID', 'asc'],
    ] as const,
  };

  pushTest({
    ...base,
    name: 'fetch one parent, one child, add grandchild',
    sources: [[{id: 'i1'}], [{issueID: 'i1', labelID: 'l1'}], []],
    sorts,
    pushes: [[2, {type: 'add', row: {id: 'l1'}}]],
    expectedLog: [
      ['2', 'push', {type: 'add', row: {id: 'l1'}}],
      ['1', 'fetch', {constraint: {key: 'labelID', value: 'l1'}}],
      ['0', 'fetch', {constraint: {key: 'id', value: 'i1'}}],
    ],
    expectedPrimaryKeySetStorageKeys: [[['i1', 'i1']], [['l1', 'i1', 'l1']]],
    expectedOutput: [
      {
        type: 'child',
        row: {
          id: 'i1',
        },
        child: {
          relationshipName: 'issuelabels',
          change: {
            type: 'child',
            row: {
              issueID: 'i1',
              labelID: 'l1',
            },
            child: {
              relationshipName: 'labels',
              change: {
                type: 'add',
                node: {
                  row: {
                    id: 'l1',
                  },
                  relationships: {},
                },
              },
            },
          },
        },
      },
    ],
  });

  pushTest({
    ...base,
    name: 'fetch one parent, one grandchild, add child',
    sources: [[{id: 'i1'}], [], [{id: 'l1'}]],
    sorts,
    pushes: [[1, {type: 'add', row: {issueID: 'i1', labelID: 'l1'}}]],
    expectedLog: [
      ['1', 'push', {type: 'add', row: {issueID: 'i1', labelID: 'l1'}}],
      ['2', 'fetch', {constraint: {key: 'id', value: 'l1'}}],
      ['0', 'fetch', {constraint: {key: 'id', value: 'i1'}}],
    ],
    expectedPrimaryKeySetStorageKeys: [[['i1', 'i1']], [['l1', 'i1', 'l1']]],
    expectedOutput: [
      {
        type: 'child',
        row: {
          id: 'i1',
        },
        child: {
          relationshipName: 'issuelabels',
          change: {
            type: 'add',
            node: {
              row: {
                issueID: 'i1',
                labelID: 'l1',
              },
              relationships: {
                labels: [{row: {id: 'l1'}, relationships: {}}],
              },
            },
          },
        },
      },
    ],
  });

  pushTest({
    ...base,
    name: 'fetch two parents, two children, add one grandchild',
    sources: [
      [{id: 'i1'}, {id: 'i2'}],
      [
        {issueID: 'i1', labelID: 'l1'},
        {issueID: 'i2', labelID: 'l1'},
      ],
      [],
    ],
    sorts,
    pushes: [[2, {type: 'add', row: {id: 'l1'}}]],
    expectedLog: [
      ['2', 'push', {type: 'add', row: {id: 'l1'}}],
      ['1', 'fetch', {constraint: {key: 'labelID', value: 'l1'}}],
      ['0', 'fetch', {constraint: {key: 'id', value: 'i1'}}],
      ['0', 'fetch', {constraint: {key: 'id', value: 'i2'}}],
    ],
    expectedPrimaryKeySetStorageKeys: [
      [
        ['i1', 'i1'],
        ['i2', 'i2'],
      ],
      [
        ['l1', 'i1', 'l1'],
        ['l1', 'i2', 'l1'],
      ],
    ],
    expectedOutput: [
      {
        type: 'child',
        row: {
          id: 'i1',
        },
        child: {
          relationshipName: 'issuelabels',
          change: {
            type: 'child',
            row: {
              issueID: 'i1',
              labelID: 'l1',
            },
            child: {
              relationshipName: 'labels',
              change: {
                type: 'add',
                node: {
                  row: {
                    id: 'l1',
                  },
                  relationships: {},
                },
              },
            },
          },
        },
      },
      {
        type: 'child',
        row: {
          id: 'i2',
        },
        child: {
          relationshipName: 'issuelabels',
          change: {
            type: 'child',
            row: {
              issueID: 'i2',
              labelID: 'l1',
            },
            child: {
              relationshipName: 'labels',
              change: {
                type: 'add',
                node: {
                  row: {
                    id: 'l1',
                  },
                  relationships: {},
                },
              },
            },
          },
        },
      },
    ],
  });
});

function pushTest(t: PushTest) {
  test(t.name, () => {
    assert(t.sources.length > 0);
    assert(t.joins.length === t.sources.length - 1);

    const log: SnitchMessage[] = [];

    const sources = t.sources.map((rows, i) =>
      makeSource(
        rows,
        t.sorts?.[i] ?? [['id', 'asc']],
        t.columns[i],
        t.primaryKeys[i],
        String(i),
        log,
      ),
    );

    const joins: {
      join: Join;
      storage: MemoryStorage;
    }[] = [];
    // Although we tend to think of the joins from left to right, we need to
    // build them from right to left.
    for (let i = t.joins.length - 1; i >= 0; i--) {
      const info = t.joins[i];
      const parent = sources[i].snitch;
      const child =
        i === t.joins.length - 1 ? sources[i + 1].snitch : joins[i + 1].join;
      const storage = new MemoryStorage();
      const join = new Join({
        parent,
        child,
        storage,
        ...info,
        hidden: false,
      });
      joins[i] = {
        join,
        storage,
      };
    }

    // By convention we put them in the test bottom up. Why? Easier to think
    // left-to-right.
    const finalJoin = joins[0];
    const c = new Catch(finalJoin.join);

    c.fetch();
    log.length = 0;

    for (const [sourceIndex, change] of t.pushes) {
      sources[sourceIndex].source.push(change);
    }

    for (const [i, j] of joins.entries()) {
      const {storage} = j;
      const expectedStorageKeys = t.expectedPrimaryKeySetStorageKeys[i];
      const expectedStorage: Record<string, boolean> = {};
      for (const k of expectedStorageKeys) {
        expectedStorage[createPrimaryKeySetStorageKey(k)] = true;
      }
      expect(storage.cloneData()).toEqual(expectedStorage);
    }

    expect(log).toEqual(t.expectedLog);
    expect(c.pushes).toEqual(t.expectedOutput);
  });
}

type PushTest = {
  name: string;
  columns: readonly Record<string, SchemaValue>[];
  primaryKeys: readonly PrimaryKey[];
  sources: Row[][];
  sorts?: Record<number, Ordering> | undefined;
  joins: readonly {
    parentKey: string;
    childKey: string;
    relationshipName: string;
  }[];
  pushes: [sourceIndex: number, change: SourceChange][];
  expectedLog: SnitchMessage[];
  expectedPrimaryKeySetStorageKeys: NormalizedValue[][][];
  expectedOutput: Change[];
};

function makeSource(
  rows: Row[],
  ordering: Ordering,
  columns: Record<string, SchemaValue>,
  primaryKeys: PrimaryKey,
  snitchName: string,
  log: SnitchMessage[],
): {source: MemorySource; snitch: Snitch} {
  const source = new MemorySource('test', columns, primaryKeys);
  for (const row of rows) {
    source.push({type: 'add', row});
  }
  const snitch = new Snitch(source.connect(ordering), snitchName, log);
  return {
    source,
    snitch,
  };
}

type Sources = Record<
  string,
  {
    columns: Record<string, SchemaValue>;
    primaryKeys: PrimaryKey;
    sorts: Ordering;
    rows: Row[];
  }
>;

type Joins = Record<
  string,
  {
    parentKey: string;
    parentSource: string;
    childKey: string;
    childSource: string;
    relationshipName: string;
  }
>;

type Pushes = [sourceName: string, change: SourceChange][];

type NewPushTest = {
  sources: Sources;
  format: Format;
  joins: Joins;
  pushes: Pushes;
};

function runJoinTest(t: NewPushTest) {
  function innerTest<T>(makeFinalOutput: (j: Input) => T) {
    const log: SnitchMessage[] = [];

    const sources: Record<
      string,
      {
        source: MemorySource;
        snitch: Snitch;
      }
    > = Object.fromEntries(
      Object.entries(t.sources).map(
        ([name, {columns, primaryKeys, sorts, rows}]) => [
          name,
          makeSource(rows, sorts, columns, primaryKeys, name, log),
        ],
      ),
    );

    const joins: Record<
      string,
      {
        join: Join;
        storage: MemoryStorage;
        snitch: Snitch;
      }
    > = {};
    let last;
    for (const [name, info] of Object.entries(t.joins)) {
      const storage = new MemoryStorage();
      const join = new Join({
        parent: (sources[info.parentSource] ?? joins[info.parentSource]).snitch,
        parentKey: info.parentKey,
        child: (sources[info.childSource] ?? joins[info.childSource]).snitch,
        childKey: info.childKey,
        storage,
        relationshipName: info.relationshipName,
        hidden: false,
      });
      const snitch = new Snitch(join, name, log);
      last = joins[name] = {
        join,
        storage,
        snitch,
      };
    }

    // By convention we put them in the test bottom up. Why? Easier to think
    // left-to-right.
    const finalOutput = makeFinalOutput(must(last).snitch);

    log.length = 0;

    for (const [sourceIndex, change] of t.pushes) {
      sources[sourceIndex].source.push(change);
    }

    const actualStorage: Record<string, JSONObject> = {};
    for (const [name, {storage}] of Object.entries(joins)) {
      actualStorage[name] = storage.cloneData();
    }

    return {
      log,
      finalOutput,
      actualStorage,
    };
  }

  const {
    log,
    finalOutput: catchOp,
    actualStorage,
  } = innerTest(j => {
    const c = new Catch(j);
    c.fetch();
    return c;
  });

  let data;
  const {
    log: log2,
    finalOutput: view,
    actualStorage: actualStorage2,
  } = innerTest(j => {
    const view = new ArrayView(j, t.format);
    data = view.data;
    return view;
  });

  view.addListener(v => {
    data = v;
  });

  expect(log).toEqual(log2);
  expect(actualStorage).toEqual(actualStorage2);

  view.flush();
  return {
    log,
    actualStorage,
    pushes: catchOp.pushes,
    data,
  };
}

describe('edit assignee', () => {
  const sources: Sources = {
    issue: {
      columns: {
        issueID: {type: 'string'},
        text: {type: 'string'},
        assigneeID: {type: 'string', optional: true},
        creatorID: {type: 'string'},
      },
      primaryKeys: ['issueID'],
      sorts: [['issueID', 'asc']],
      rows: [
        {
          issueID: 'i1',
          text: 'first issue',
          assigneeID: undefined,
          creatorID: 'u1',
        },
        {
          issueID: 'i2',
          text: 'second issue',
          assigneeID: 'u2',
          creatorID: 'u2',
        },
      ],
    },
    user: {
      columns: {
        userID: {type: 'string'},
        name: {type: 'string'},
      },
      primaryKeys: ['userID'],
      sorts: [['userID', 'asc']],
      rows: [
        {userID: 'u1', name: 'user 1'},
        {userID: 'u2', name: 'user 2'},
      ],
    },
  };

  const joins: Joins = {
    creator: {
      parentKey: 'creatorID',
      parentSource: 'issue',
      childKey: 'userID',
      childSource: 'user',
      relationshipName: 'creator',
    },
    assignee: {
      parentKey: 'assigneeID',
      parentSource: 'creator',
      childKey: 'userID',
      childSource: 'user',
      relationshipName: 'assignee',
    },
  };

  const format: Format = {
    singular: false,
    relationships: {
      creator: {
        singular: false,
        relationships: {},
      },
      assignee: {
        singular: false,
        relationships: {},
      },
    },
  };

  test('from none to one', () => {
    const {log, data, actualStorage, pushes} = runJoinTest({
      sources,
      joins,
      pushes: [
        [
          'issue',
          {
            type: 'edit',
            oldRow: {
              issueID: 'i1',
              text: 'first issue',
              assigneeID: undefined,
              creatorID: 'u1',
            },
            row: {
              issueID: 'i1',
              text: 'first issue',
              assigneeID: 'u1',
              creatorID: 'u1',
            },
          },
        ],
      ],
      format,
    });

    expect(data).toMatchInlineSnapshot(`
      [
        {
          "assignee": [
            {
              "name": "user 1",
              "userID": "u1",
            },
          ],
          "assigneeID": "u1",
          "creator": [
            {
              "name": "user 1",
              "userID": "u1",
            },
          ],
          "creatorID": "u1",
          "issueID": "i1",
          "text": "first issue",
        },
        {
          "assignee": [
            {
              "name": "user 2",
              "userID": "u2",
            },
          ],
          "assigneeID": "u2",
          "creator": [
            {
              "name": "user 2",
              "userID": "u2",
            },
          ],
          "creatorID": "u2",
          "issueID": "i2",
          "text": "second issue",
        },
      ]
    `);

    expect(log).toMatchInlineSnapshot(`
      [
        [
          "issue",
          "push",
          {
            "oldRow": {
              "assigneeID": undefined,
              "creatorID": "u1",
              "issueID": "i1",
              "text": "first issue",
            },
            "row": {
              "assigneeID": "u1",
              "creatorID": "u1",
              "issueID": "i1",
              "text": "first issue",
            },
            "type": "edit",
          },
        ],
        [
          "creator",
          "push",
          {
            "oldRow": {
              "assigneeID": undefined,
              "creatorID": "u1",
              "issueID": "i1",
              "text": "first issue",
            },
            "row": {
              "assigneeID": "u1",
              "creatorID": "u1",
              "issueID": "i1",
              "text": "first issue",
            },
            "type": "edit",
          },
        ],
        [
          "assignee",
          "push",
          {
            "oldRow": {
              "assigneeID": undefined,
              "creatorID": "u1",
              "issueID": "i1",
              "text": "first issue",
            },
            "row": {
              "assigneeID": "u1",
              "creatorID": "u1",
              "issueID": "i1",
              "text": "first issue",
            },
            "type": "edit",
          },
        ],
        [
          "user",
          "cleanup",
          {
            "constraint": {
              "key": "userID",
              "value": null,
            },
          },
        ],
        [
          "user",
          "fetch",
          {
            "constraint": {
              "key": "userID",
              "value": "u1",
            },
          },
        ],
        [
          "assignee",
          "push",
          {
            "child": {
              "row": {
                "name": "user 1",
                "userID": "u1",
              },
              "type": "add",
            },
            "row": {
              "assigneeID": "u1",
              "creatorID": "u1",
              "issueID": "i1",
              "text": "first issue",
            },
            "type": "child",
          },
        ],
      ]
    `);

    expect(pushes).toMatchInlineSnapshot(`
      [
        {
          "oldRow": {
            "assigneeID": undefined,
            "creatorID": "u1",
            "issueID": "i1",
            "text": "first issue",
          },
          "row": {
            "assigneeID": "u1",
            "creatorID": "u1",
            "issueID": "i1",
            "text": "first issue",
          },
          "type": "edit",
        },
        {
          "child": {
            "change": {
              "node": {
                "relationships": {},
                "row": {
                  "name": "user 1",
                  "userID": "u1",
                },
              },
              "type": "add",
            },
            "relationshipName": "assignee",
          },
          "row": {
            "assigneeID": "u1",
            "creatorID": "u1",
            "issueID": "i1",
            "text": "first issue",
          },
          "type": "child",
        },
      ]
    `);

    expect(actualStorage).toMatchInlineSnapshot(`
    {
      "assignee": {
        ""pKeySet","u1","i1",": true,
        ""pKeySet","u2","i2",": true,
      },
      "creator": {
        ""pKeySet","u1","i1",": true,
        ""pKeySet","u2","i2",": true,
      },
    }
  `);
  });

  test('from none to many', () => {
    const localSources: Sources = {
      ...sources,
      user: {
        columns: {
          userID: {type: 'string'},
          id: {type: 'number'},
          name: {type: 'string'},
        },
        primaryKeys: ['userID', 'id'],
        sorts: [
          ['userID', 'asc'],
          ['id', 'asc'],
        ],
        rows: [
          {userID: 'u1', id: 1, name: 'user 1'},
          {userID: 'u1', id: 1.5, name: 'user 1.5'},
          {userID: 'u2', id: 2, name: 'user 2'},
        ],
      },
    };

    const {log, data, actualStorage, pushes} = runJoinTest({
      sources: localSources,
      joins,
      pushes: [
        [
          'issue',
          {
            type: 'edit',
            oldRow: {
              issueID: 'i1',
              text: 'first issue',
              assigneeID: undefined,
              creatorID: 'u1',
            },
            row: {
              issueID: 'i1',
              text: 'first issue',
              assigneeID: 'u1',
              creatorID: 'u1',
            },
          },
        ],
      ],
      format,
    });

    expect(data).toMatchInlineSnapshot(`
      [
        {
          "assignee": [
            {
              "id": 1,
              "name": "user 1",
              "userID": "u1",
            },
            {
              "id": 1.5,
              "name": "user 1.5",
              "userID": "u1",
            },
          ],
          "assigneeID": "u1",
          "creator": [
            {
              "id": 1,
              "name": "user 1",
              "userID": "u1",
            },
            {
              "id": 1.5,
              "name": "user 1.5",
              "userID": "u1",
            },
          ],
          "creatorID": "u1",
          "issueID": "i1",
          "text": "first issue",
        },
        {
          "assignee": [
            {
              "id": 2,
              "name": "user 2",
              "userID": "u2",
            },
          ],
          "assigneeID": "u2",
          "creator": [
            {
              "id": 2,
              "name": "user 2",
              "userID": "u2",
            },
          ],
          "creatorID": "u2",
          "issueID": "i2",
          "text": "second issue",
        },
      ]
    `);

    expect(log).toMatchInlineSnapshot(`
      [
        [
          "issue",
          "push",
          {
            "oldRow": {
              "assigneeID": undefined,
              "creatorID": "u1",
              "issueID": "i1",
              "text": "first issue",
            },
            "row": {
              "assigneeID": "u1",
              "creatorID": "u1",
              "issueID": "i1",
              "text": "first issue",
            },
            "type": "edit",
          },
        ],
        [
          "creator",
          "push",
          {
            "oldRow": {
              "assigneeID": undefined,
              "creatorID": "u1",
              "issueID": "i1",
              "text": "first issue",
            },
            "row": {
              "assigneeID": "u1",
              "creatorID": "u1",
              "issueID": "i1",
              "text": "first issue",
            },
            "type": "edit",
          },
        ],
        [
          "assignee",
          "push",
          {
            "oldRow": {
              "assigneeID": undefined,
              "creatorID": "u1",
              "issueID": "i1",
              "text": "first issue",
            },
            "row": {
              "assigneeID": "u1",
              "creatorID": "u1",
              "issueID": "i1",
              "text": "first issue",
            },
            "type": "edit",
          },
        ],
        [
          "user",
          "cleanup",
          {
            "constraint": {
              "key": "userID",
              "value": null,
            },
          },
        ],
        [
          "user",
          "fetch",
          {
            "constraint": {
              "key": "userID",
              "value": "u1",
            },
          },
        ],
        [
          "assignee",
          "push",
          {
            "child": {
              "row": {
                "id": 1,
                "name": "user 1",
                "userID": "u1",
              },
              "type": "add",
            },
            "row": {
              "assigneeID": "u1",
              "creatorID": "u1",
              "issueID": "i1",
              "text": "first issue",
            },
            "type": "child",
          },
        ],
        [
          "assignee",
          "push",
          {
            "child": {
              "row": {
                "id": 1.5,
                "name": "user 1.5",
                "userID": "u1",
              },
              "type": "add",
            },
            "row": {
              "assigneeID": "u1",
              "creatorID": "u1",
              "issueID": "i1",
              "text": "first issue",
            },
            "type": "child",
          },
        ],
      ]
    `);

    expect(pushes).toMatchInlineSnapshot(`
      [
        {
          "oldRow": {
            "assigneeID": undefined,
            "creatorID": "u1",
            "issueID": "i1",
            "text": "first issue",
          },
          "row": {
            "assigneeID": "u1",
            "creatorID": "u1",
            "issueID": "i1",
            "text": "first issue",
          },
          "type": "edit",
        },
        {
          "child": {
            "change": {
              "node": {
                "relationships": {},
                "row": {
                  "id": 1,
                  "name": "user 1",
                  "userID": "u1",
                },
              },
              "type": "add",
            },
            "relationshipName": "assignee",
          },
          "row": {
            "assigneeID": "u1",
            "creatorID": "u1",
            "issueID": "i1",
            "text": "first issue",
          },
          "type": "child",
        },
        {
          "child": {
            "change": {
              "node": {
                "relationships": {},
                "row": {
                  "id": 1.5,
                  "name": "user 1.5",
                  "userID": "u1",
                },
              },
              "type": "add",
            },
            "relationshipName": "assignee",
          },
          "row": {
            "assigneeID": "u1",
            "creatorID": "u1",
            "issueID": "i1",
            "text": "first issue",
          },
          "type": "child",
        },
      ]
    `);

    expect(actualStorage).toMatchInlineSnapshot(`
    {
      "assignee": {
        ""pKeySet","u1","i1",": true,
        ""pKeySet","u2","i2",": true,
      },
      "creator": {
        ""pKeySet","u1","i1",": true,
        ""pKeySet","u2","i2",": true,
      },
    }
  `);
  });

  test('from one to none', () => {
    const localSources = structuredClone(sources);
    localSources.issue.rows[0].assigneeID = 'u1';

    const {log, data, actualStorage, pushes} = runJoinTest({
      sources: localSources,
      joins,
      pushes: [
        [
          'issue',
          {
            type: 'edit',
            oldRow: {
              issueID: 'i1',
              text: 'first issue',
              assigneeID: 'u1',
              creatorID: 'u1',
            },
            row: {
              issueID: 'i1',
              text: 'first issue',
              assigneeID: undefined,
              creatorID: 'u1',
            },
          },
        ],
      ],
      format,
    });

    expect(data).toMatchInlineSnapshot(`
      [
        {
          "assignee": [],
          "assigneeID": undefined,
          "creator": [
            {
              "name": "user 1",
              "userID": "u1",
            },
          ],
          "creatorID": "u1",
          "issueID": "i1",
          "text": "first issue",
        },
        {
          "assignee": [
            {
              "name": "user 2",
              "userID": "u2",
            },
          ],
          "assigneeID": "u2",
          "creator": [
            {
              "name": "user 2",
              "userID": "u2",
            },
          ],
          "creatorID": "u2",
          "issueID": "i2",
          "text": "second issue",
        },
      ]
    `);

    expect(log).toMatchInlineSnapshot(`
      [
        [
          "issue",
          "push",
          {
            "oldRow": {
              "assigneeID": "u1",
              "creatorID": "u1",
              "issueID": "i1",
              "text": "first issue",
            },
            "row": {
              "assigneeID": undefined,
              "creatorID": "u1",
              "issueID": "i1",
              "text": "first issue",
            },
            "type": "edit",
          },
        ],
        [
          "creator",
          "push",
          {
            "oldRow": {
              "assigneeID": "u1",
              "creatorID": "u1",
              "issueID": "i1",
              "text": "first issue",
            },
            "row": {
              "assigneeID": undefined,
              "creatorID": "u1",
              "issueID": "i1",
              "text": "first issue",
            },
            "type": "edit",
          },
        ],
        [
          "assignee",
          "push",
          {
            "oldRow": {
              "assigneeID": "u1",
              "creatorID": "u1",
              "issueID": "i1",
              "text": "first issue",
            },
            "row": {
              "assigneeID": undefined,
              "creatorID": "u1",
              "issueID": "i1",
              "text": "first issue",
            },
            "type": "edit",
          },
        ],
        [
          "user",
          "cleanup",
          {
            "constraint": {
              "key": "userID",
              "value": "u1",
            },
          },
        ],
        [
          "assignee",
          "push",
          {
            "child": {
              "row": {
                "name": "user 1",
                "userID": "u1",
              },
              "type": "remove",
            },
            "row": {
              "assigneeID": undefined,
              "creatorID": "u1",
              "issueID": "i1",
              "text": "first issue",
            },
            "type": "child",
          },
        ],
        [
          "user",
          "fetch",
          {
            "constraint": {
              "key": "userID",
              "value": null,
            },
          },
        ],
      ]
    `);

    expect(pushes).toMatchInlineSnapshot(`
      [
        {
          "oldRow": {
            "assigneeID": "u1",
            "creatorID": "u1",
            "issueID": "i1",
            "text": "first issue",
          },
          "row": {
            "assigneeID": undefined,
            "creatorID": "u1",
            "issueID": "i1",
            "text": "first issue",
          },
          "type": "edit",
        },
        {
          "child": {
            "change": {
              "node": {
                "relationships": {},
                "row": {
                  "name": "user 1",
                  "userID": "u1",
                },
              },
              "type": "remove",
            },
            "relationshipName": "assignee",
          },
          "row": {
            "assigneeID": undefined,
            "creatorID": "u1",
            "issueID": "i1",
            "text": "first issue",
          },
          "type": "child",
        },
      ]
    `);

    expect(actualStorage).toMatchInlineSnapshot(`
      {
        "assignee": {
          ""pKeySet","u2","i2",": true,
          ""pKeySet",null,"i1",": true,
        },
        "creator": {
          ""pKeySet","u1","i1",": true,
          ""pKeySet","u2","i2",": true,
        },
      }
    `);
  });

  test('from many to none', () => {
    const issue = structuredClone(sources.issue);
    issue.rows[0].assigneeID = 'u1';
    const localSources: Sources = {
      issue,
      user: {
        columns: {
          userID: {type: 'string'},
          id: {type: 'number'},
          name: {type: 'string'},
        },
        primaryKeys: ['userID', 'id'],
        sorts: [
          ['userID', 'asc'],
          ['id', 'asc'],
        ],
        rows: [
          {userID: 'u1', id: 1, name: 'user 1'},
          {userID: 'u1', id: 1.5, name: 'user 1.5'},
          {userID: 'u2', id: 2, name: 'user 2'},
        ],
      },
    };
    const {log, data, actualStorage, pushes} = runJoinTest({
      sources: localSources,
      joins,
      pushes: [
        [
          'issue',
          {
            type: 'edit',
            oldRow: {
              issueID: 'i1',
              text: 'first issue',
              assigneeID: 'u1',
              creatorID: 'u1',
            },
            row: {
              issueID: 'i1',
              text: 'first issue',
              assigneeID: undefined,
              creatorID: 'u1',
            },
          },
        ],
      ],
      format,
    });

    expect(data).toMatchInlineSnapshot(`
      [
        {
          "assignee": [],
          "assigneeID": undefined,
          "creator": [
            {
              "id": 1,
              "name": "user 1",
              "userID": "u1",
            },
            {
              "id": 1.5,
              "name": "user 1.5",
              "userID": "u1",
            },
          ],
          "creatorID": "u1",
          "issueID": "i1",
          "text": "first issue",
        },
        {
          "assignee": [
            {
              "id": 2,
              "name": "user 2",
              "userID": "u2",
            },
          ],
          "assigneeID": "u2",
          "creator": [
            {
              "id": 2,
              "name": "user 2",
              "userID": "u2",
            },
          ],
          "creatorID": "u2",
          "issueID": "i2",
          "text": "second issue",
        },
      ]
    `);

    expect(log).toMatchInlineSnapshot(`
      [
        [
          "issue",
          "push",
          {
            "oldRow": {
              "assigneeID": "u1",
              "creatorID": "u1",
              "issueID": "i1",
              "text": "first issue",
            },
            "row": {
              "assigneeID": undefined,
              "creatorID": "u1",
              "issueID": "i1",
              "text": "first issue",
            },
            "type": "edit",
          },
        ],
        [
          "creator",
          "push",
          {
            "oldRow": {
              "assigneeID": "u1",
              "creatorID": "u1",
              "issueID": "i1",
              "text": "first issue",
            },
            "row": {
              "assigneeID": undefined,
              "creatorID": "u1",
              "issueID": "i1",
              "text": "first issue",
            },
            "type": "edit",
          },
        ],
        [
          "assignee",
          "push",
          {
            "oldRow": {
              "assigneeID": "u1",
              "creatorID": "u1",
              "issueID": "i1",
              "text": "first issue",
            },
            "row": {
              "assigneeID": undefined,
              "creatorID": "u1",
              "issueID": "i1",
              "text": "first issue",
            },
            "type": "edit",
          },
        ],
        [
          "user",
          "cleanup",
          {
            "constraint": {
              "key": "userID",
              "value": "u1",
            },
          },
        ],
        [
          "assignee",
          "push",
          {
            "child": {
              "row": {
                "id": 1,
                "name": "user 1",
                "userID": "u1",
              },
              "type": "remove",
            },
            "row": {
              "assigneeID": undefined,
              "creatorID": "u1",
              "issueID": "i1",
              "text": "first issue",
            },
            "type": "child",
          },
        ],
        [
          "assignee",
          "push",
          {
            "child": {
              "row": {
                "id": 1.5,
                "name": "user 1.5",
                "userID": "u1",
              },
              "type": "remove",
            },
            "row": {
              "assigneeID": undefined,
              "creatorID": "u1",
              "issueID": "i1",
              "text": "first issue",
            },
            "type": "child",
          },
        ],
        [
          "user",
          "fetch",
          {
            "constraint": {
              "key": "userID",
              "value": null,
            },
          },
        ],
      ]
    `);

    expect(pushes).toMatchInlineSnapshot(`
      [
        {
          "oldRow": {
            "assigneeID": "u1",
            "creatorID": "u1",
            "issueID": "i1",
            "text": "first issue",
          },
          "row": {
            "assigneeID": undefined,
            "creatorID": "u1",
            "issueID": "i1",
            "text": "first issue",
          },
          "type": "edit",
        },
        {
          "child": {
            "change": {
              "node": {
                "relationships": {},
                "row": {
                  "id": 1,
                  "name": "user 1",
                  "userID": "u1",
                },
              },
              "type": "remove",
            },
            "relationshipName": "assignee",
          },
          "row": {
            "assigneeID": undefined,
            "creatorID": "u1",
            "issueID": "i1",
            "text": "first issue",
          },
          "type": "child",
        },
        {
          "child": {
            "change": {
              "node": {
                "relationships": {},
                "row": {
                  "id": 1.5,
                  "name": "user 1.5",
                  "userID": "u1",
                },
              },
              "type": "remove",
            },
            "relationshipName": "assignee",
          },
          "row": {
            "assigneeID": undefined,
            "creatorID": "u1",
            "issueID": "i1",
            "text": "first issue",
          },
          "type": "child",
        },
      ]
    `);

    expect(actualStorage).toMatchInlineSnapshot(`
      {
        "assignee": {
          ""pKeySet","u2","i2",": true,
          ""pKeySet",null,"i1",": true,
        },
        "creator": {
          ""pKeySet","u1","i1",": true,
          ""pKeySet","u2","i2",": true,
        },
      }
    `);
  });
});