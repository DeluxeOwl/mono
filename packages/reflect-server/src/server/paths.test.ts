import {describe, expect, test} from '@jest/globals';
import {
  CLOSE_ROOM_PATH,
  CREATE_ROOM_PATH,
  DELETE_ROOM_PATH,
  GET_ROOM_PATH,
  INVALIDATE_ALL_CONNECTIONS_PATH,
  INVALIDATE_USER_CONNECTIONS_PATH,
  LIST_ROOMS_PATH,
  fmtPath,
} from './paths.js';

describe('paths', () => {
  describe('fmtPath', () => {
    type Case = {
      name: string;
      pattern: string;
      groups?: Record<string, string>;
      result: string;
    };
    const cases: Case[] = [
      {
        name: 'simple roomID',
        pattern: CREATE_ROOM_PATH,
        groups: {roomID: 'foo-room'},
        result: '/api/v1/rooms/foo-room:create',
      },
      {
        name: 'roomID with special characters',
        pattern: DELETE_ROOM_PATH,
        groups: {roomID: 'room/id?with\\special:characters'},
        result: '/api/v1/rooms/room%2Fid%3Fwith%5Cspecial%3Acharacters:delete',
      },
      {
        name: 'userID',
        pattern: INVALIDATE_USER_CONNECTIONS_PATH,
        groups: {userID: 'foo-user'},
        result: '/api/v1/connections/users/foo-user:invalidate',
      },
      {
        name: 'no groups',
        pattern: INVALIDATE_ALL_CONNECTIONS_PATH,
        result: '/api/v1/connections:invalidate',
      },
      {
        name: 'get room',
        pattern: GET_ROOM_PATH,
        groups: {roomID: 'my/room/id'},
        result: '/api/v1/rooms/my%2Froom%2Fid',
      },
      {
        name: 'list rooms',
        pattern: LIST_ROOMS_PATH,
        result: '/api/v1/rooms',
      },
    ];

    cases.forEach(c => {
      test(c.name, () => {
        expect(fmtPath(c.pattern, c.groups)).toBe(c.result);
        const parsed = new URLPattern({pathname: c.pattern}).exec(
          `https://api.reflect-server.net${c.result}`,
        );
        const decoded = Object.fromEntries(
          Object.entries(parsed?.pathname.groups ?? {}).map(([name, value]) => [
            name,
            decodeURIComponent(value),
          ]),
        );
        expect(decoded).toEqual(c.groups ?? {});
      });
    });
  });

  for (const url of [
    // Future commands and/or urls with delimiters that we use or may use
    // in the future should not be mistakenly matched as part of an ID.
    'https://api.reflect-server.net/api/v1/rooms/fooID/subresource',
    'https://api.reflect-server.net/api/v1/rooms/fooID:futurecommand',
    'https://api.reflect-server.net/api/v1/rooms/fooID//empty',
    'https://api.reflect-server.net/api/v1/rooms/fooID@something',
    'https://api.reflect-server.net/api/v1/rooms/fooID$dollar',
    'https://api.reflect-server.net/api/v1/rooms/fooID^caret',
    'https://api.reflect-server.net/api/v1/rooms/fooID&ampersand',
    'https://api.reflect-server.net/api/v1/rooms/fooID=equals',
    'https://api.reflect-server.net/api/v1/rooms/fooID=equals',
    'https://api.reflect-server.net/api/v1/rooms/fooID[square',
    'https://api.reflect-server.net/api/v1/rooms/fooID]square',
    'https://api.reflect-server.net/api/v1/rooms/fooID;semicolon',
    'https://api.reflect-server.net/api/v1/rooms/fooID|pipe',
    'https://api.reflect-server.net/api/v1/rooms/fooID,comma',
  ]) {
    test(`strict id matching (${url})`, () => {
      for (const pathname of [
        GET_ROOM_PATH,
        LIST_ROOMS_PATH,
        CREATE_ROOM_PATH,
        CLOSE_ROOM_PATH,
        DELETE_ROOM_PATH,
      ])
        expect(new URLPattern({pathname}).test(url)).toBe(false);
    });
  }

  test('room paths are mutually exclusive', () => {
    const LIST_ROOMS_URLS = [
      'https://api.reflect-server.net/api/v1/rooms',
      'https://api.reflect-server.net/api/v1/rooms?startKey=foo&maxResults=200',
      'https://api.reflect-server.net/api/v1/rooms#ignored',
    ];
    const GET_ROOM_URLS = [
      'https://api.reflect-server.net/api/v1/rooms/foo-id',
      'https://api.reflect-server.net/api/v1/rooms/%2A',
      'https://api.reflect-server.net/api/v1/rooms/bar?startKey=ignored',
      'https://api.reflect-server.net/api/v1/rooms/bar#ignored',
    ];
    const CREATE_ROOM_URLS = [
      'https://api.reflect-server.net/api/v1/rooms/foo-id:create',
      'https://api.reflect-server.net/api/v1/rooms/foo-id:create#ignored',
      'https://api.reflect-server.net/api/v1/rooms/foo-id:create?ignored=fornow',
    ];
    for (const url of LIST_ROOMS_URLS) {
      expect(new URLPattern({pathname: LIST_ROOMS_PATH}).test(url)).toBe(true);
      expect(new URLPattern({pathname: GET_ROOM_PATH}).test(url)).toBe(false);
      expect(new URLPattern({pathname: CREATE_ROOM_PATH}).test(url)).toBe(
        false,
      );
    }
    for (const url of GET_ROOM_URLS) {
      expect(new URLPattern({pathname: LIST_ROOMS_PATH}).test(url)).toBe(false);
      expect(new URLPattern({pathname: GET_ROOM_PATH}).test(url)).toBe(true);
      expect(new URLPattern({pathname: CREATE_ROOM_PATH}).test(url)).toBe(
        false,
      );
    }
    for (const url of CREATE_ROOM_URLS) {
      expect(new URLPattern({pathname: LIST_ROOMS_PATH}).test(url)).toBe(false);
      expect(new URLPattern({pathname: GET_ROOM_PATH}).test(url)).toBe(false);
      expect(new URLPattern({pathname: CREATE_ROOM_PATH}).test(url)).toBe(true);
    }
  });
});
