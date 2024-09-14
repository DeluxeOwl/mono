import {describe, expect, test} from 'vitest';
import {ReplicationMessages} from '../replicator/test-utils.js';
import {Forwarder} from './forwarder.js';
import {createSubscriber} from './test-utils.js';

describe('change-streamer/forwarder', () => {
  const messages = new ReplicationMessages({issues: 'id'});

  test('in transaction queueing', () => {
    const forwarder = new Forwarder();

    const [sub1, stream1] = createSubscriber('00', true);
    const [sub2, stream2] = createSubscriber('00', true);
    const [sub3, stream3] = createSubscriber('00', true);
    const [sub4, stream4] = createSubscriber('00', true);

    forwarder.add(sub1);
    forwarder.forward({watermark: '11', change: messages.begin()});
    forwarder.add(sub2);
    forwarder.forward({watermark: '12', change: messages.truncate('issues')});
    forwarder.forward({watermark: '13', change: messages.commit()});
    forwarder.add(sub3);
    forwarder.forward({watermark: '14', change: messages.begin()});
    forwarder.add(sub4);

    for (const sub of [sub1, sub2, sub3, sub4]) {
      sub.close();
    }

    // sub1 gets all of the messages, as it was not added in a transaction.
    expect(stream1).toMatchInlineSnapshot(`
      [
        [
          "change",
          {
            "change": {
              "tag": "begin",
            },
            "watermark": "11",
          },
        ],
        [
          "change",
          {
            "change": {
              "cascade": false,
              "relations": [
                {
                  "columns": [
                    {
                      "flags": 1,
                      "name": "id",
                      "parser": [Function],
                      "typeMod": -1,
                      "typeName": null,
                      "typeOid": 23,
                      "typeSchema": null,
                    },
                  ],
                  "keyColumns": [
                    "id",
                  ],
                  "name": "issues",
                  "relationOid": 1558331249,
                  "replicaIdentity": "default",
                  "schema": "public",
                  "tag": "relation",
                },
              ],
              "restartIdentity": false,
              "tag": "truncate",
            },
            "watermark": "12",
          },
        ],
        [
          "change",
          {
            "change": {
              "tag": "commit",
            },
            "watermark": "13",
          },
        ],
        [
          "change",
          {
            "change": {
              "tag": "begin",
            },
            "watermark": "14",
          },
        ],
      ]
    `);

    // sub2 and sub3 were added in a transaction. They only see the next
    // transaction.
    expect(stream2).toMatchInlineSnapshot(`
      [
        [
          "change",
          {
            "change": {
              "tag": "begin",
            },
            "watermark": "14",
          },
        ],
      ]
    `);
    expect(stream3).toMatchInlineSnapshot(`
      [
        [
          "change",
          {
            "change": {
              "tag": "begin",
            },
            "watermark": "14",
          },
        ],
      ]
    `);

    // sub4 was added in during the second transaction. It gets nothing.
    expect(stream4).toMatchInlineSnapshot(`[]`);
  });
});