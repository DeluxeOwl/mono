import {getMockReq, getMockRes} from '@jest-mock/express';
import {afterAll, beforeAll, describe, expect, jest, test} from '@jest/globals';
import {initializeApp} from 'firebase-admin/app';
import type {Auth} from 'firebase-admin/auth';
import {Timestamp, getFirestore} from 'firebase-admin/firestore';
import {https} from 'firebase-functions/v2';
import type {Request} from 'firebase-functions/v2/https';
import {baseAppRequestFields} from 'mirror-protocol/src/app.js';
import {
  Permissions,
  appKeyDataConverter,
  appKeyPath,
} from 'mirror-schema/src/app-key.js';
import {appPath} from 'mirror-schema/src/deployment.js';
import {setApp, setUser} from 'mirror-schema/src/test-helpers.js';
import {userPath} from 'mirror-schema/src/user.js';
import * as v from 'shared/src/valita.js';
import {
  appAuthorization,
  appOrKeyAuthorization,
  authorizationHeader,
  userAuthorization,
  userOrKeyAuthorization,
} from './auth.js';
import {validateRequest} from './schema.js';

const testRequestSchema = v.object({
  ...baseAppRequestFields,
  foo: v.string(),
});

describe('validators/https', () => {
  initializeApp({projectId: 'https-validator-test'});
  const firestore = getFirestore();
  const USER_ID = 'foo';
  const APP_ID = 'myApp';
  const APP_KEY_NAME = 'bar-key';

  beforeAll(async () => {
    await Promise.all([
      setUser(firestore, USER_ID, 'foo@bar.com', 'bob', {fooTeam: 'admin'}),
      setApp(firestore, APP_ID, {teamID: 'fooTeam', name: 'MyAppName'}),
      firestore
        .doc(appKeyPath(APP_ID, APP_KEY_NAME))
        .withConverter(appKeyDataConverter)
        .set({
          value: 'super-secret-key-value',
          permissions: {'app:publish': true} as Permissions,
          created: Timestamp.now(),
          lastUsed: null,
        }),
    ]);
  });

  afterAll(async () => {
    const batch = firestore.batch();
    batch.delete(firestore.doc(userPath(USER_ID)));
    batch.delete(firestore.doc(appPath(APP_ID)));
    batch.delete(firestore.doc(appKeyPath(APP_ID, APP_KEY_NAME)));
    await batch.commit();
  });

  test('onRequestBuilder', async () => {
    const auth = {
      verifyIdToken: jest
        .fn()
        .mockImplementation(() => Promise.resolve({uid: 'foo'})),
    };
    const handler = validateRequest(testRequestSchema)
      .validate(authorizationHeader(firestore, auth as unknown as Auth))
      .validate(userAuthorization())
      .validate(appAuthorization(firestore))
      .handle((req, ctx) => {
        const {response} = ctx;
        response.json({userID: req.requester.userID, appName: ctx.app.name});
      });
    const authenticatedFunction = https.onRequest(handler);

    const req = getMockReq({
      body: {
        requester: {
          userID: 'foo',
          userAgent: {type: 'reflect-cli', version: '0.0.1'},
        },
        foo: 'boo',
        appID: 'myApp',
      },
      headers: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        Authorization: 'Bearer this-is-the-encoded-token',
      },
    }) as unknown as Request;
    const {res} = getMockRes();

    await authenticatedFunction(req, res);
    expect(auth.verifyIdToken).toBeCalledWith('this-is-the-encoded-token');
    expect(res.json).toBeCalledWith({userID: 'foo', appName: 'MyAppName'});
  });

  test('basic authorization', async () => {
    const auth = {
      verifyIdToken: jest.fn().mockImplementation(() => {
        throw new Error('should not be called');
      }),
    };
    const handler = validateRequest(testRequestSchema)
      .validate(authorizationHeader(firestore, auth as unknown as Auth))
      .validate(userOrKeyAuthorization())
      .validate(appOrKeyAuthorization(firestore, 'app:publish'))
      .handle((req, ctx) => {
        const {response} = ctx;
        response.json({userID: req.requester.userID, appName: ctx.app.name});
      });
    const authenticatedFunction = https.onRequest(handler);

    const req = getMockReq({
      body: {
        requester: {
          userID: `apps/${APP_ID}/keys/${APP_KEY_NAME}`,
          userAgent: {type: 'reflect-cli', version: '0.0.1'},
        },
        foo: 'boo',
        appID: 'myApp',
      },
      headers: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        Authorization: 'Basic super-secret-key-value',
      },
    }) as unknown as Request;
    const {res} = getMockRes();

    await authenticatedFunction(req, res);
    expect(auth.verifyIdToken).not.toBeCalled;
    expect(res.json).toBeCalledWith({
      userID: `apps/${APP_ID}/keys/${APP_KEY_NAME}`,
      appName: 'MyAppName',
    });
  });
});
