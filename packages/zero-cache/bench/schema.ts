import {Schema} from 'zql/src/zql/query/schema.js';

const memberSchema: Schema = {
  tableName: 'member',
  columns: {
    id: {type: 'string'},
    name: {type: 'string'},
  },
  primaryKey: ['id'],
  relationships: {},
};

const issueSchema: Schema = {
  tableName: 'issue',
  columns: {
    id: {type: 'string'},
    title: {type: 'string'},
    // TODO: support enum types?
    // Should we swap the fields def to Valita?
    priority: {type: 'number'},
    status: {type: 'number'},
    modified: {type: 'number'},
    created: {type: 'number'},
    creatorID: {type: 'string'},
    kanbanOrder: {type: 'string'},
    description: {type: 'string'},
  },
  primaryKey: ['id'],
  relationships: {
    labels: {
      source: 'id',
      junction: {
        schema: () => issueLabelSchema,
        sourceField: 'issueID',
        destField: 'labelID',
      },
      dest: {
        field: 'id',
        schema: () => labelSchema,
      },
    },
    comments: {
      source: 'id',
      dest: {
        field: 'issueID',
        schema: () => commentSchema,
      },
    },
    creator: {
      source: 'creatorID',
      dest: {
        field: 'id',
        schema: () => memberSchema,
      },
    },
  },
};

const commentSchema: Schema = {
  tableName: 'comment',
  columns: {
    id: {type: 'string'},
    issueID: {type: 'string'},
    created: {type: 'number'},
    body: {type: 'string'},
    creatorID: {type: 'string'},
  },
  primaryKey: ['id'],
  relationships: {
    creator: {
      source: 'creatorID',
      dest: {
        field: 'id',
        schema: () => memberSchema,
      },
    },
  },
};

const labelSchema: Schema = {
  tableName: 'label',
  columns: {
    id: {type: 'string'},
    name: {type: 'string'},
  },
  primaryKey: ['id'],
  relationships: {},
};

const issueLabelSchema: Schema = {
  tableName: 'issueLabel',
  columns: {
    id: {type: 'string'},
    issueID: {type: 'string'},
    labelID: {type: 'string'},
  },
  // mutators require an ID field still.
  primaryKey: ['id'],
  relationships: {},
};

export const schema = {
  member: memberSchema,
  issue: issueSchema,
  comment: commentSchema,
  label: labelSchema,
  issueLabel: issueLabelSchema,
} as const;

type AppSchema = typeof schema;
export {AppSchema as Schema};