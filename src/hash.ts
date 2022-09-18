import {assert} from './asserts';
import {encode} from './base32-encode';
import * as utf8 from './utf8';
import {uuid} from './uuid.js';

export const BYTE_LENGTH = 20;

export const STRING_LENGTH = 32;

// We use an opaque type so that we can make sure that a hash is always a hash.
// TypeScript does not have direct support but we can use a trick described
// here:
//
// https://evertpot.com/opaque-ts-types/
//
// The basic idea is to declare a type that cannot be created. We then use
// functions that cast a string to this type.
//

// By using declare we tell the type system that there is a unique symbol.
// However, there is no such symbol but the type system does not care.
declare const hashTag: unique symbol;

/**
 * Opaque type representing a hash. The only way to create one is using `parse`
 * or `hashOf` (except for static unsafe cast of course).
 */
export type Hash = {[hashTag]: true};

const hashRe = /^[0-9a-v]{32}$/;
const tempHashRe = /^t\/[0-9a-v]{30}$/;
const uuidHashRe = /^u\/[0-9a-f-]{36}$/;

export const SUBTLE_CRYPTO_SECURE_DOMAIN_ERROR =
  'SubtleCrypto is not available, this is probably because you are running in a non-secure context. See: https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts and https://stackoverflow.com/questions/64521474/how-to-enable-subtlecrypto-in-insecure-context-for-testing.';

/**
 * Computes a SHA512 hash of the given data.
 */
export async function hashOf<V>(
  value: V,
  getSubtle?: () => SubtleCrypto | undefined,
): Promise<Hash> {
  const typedArray = utf8.encode(JSON.stringify(value));

  // Note: despite lib.dom.ts saying that crypto.subtle is type SubtleCrypto, it's
  // actually SubtleCrypto|undefined because of secure contexts.
  const subtle = getSubtle ? getSubtle() : crypto.subtle;

  if (subtle === undefined) {
    throw new Error(SUBTLE_CRYPTO_SECURE_DOMAIN_ERROR);
  }
  const buf = await subtle.digest('SHA-512', typedArray);
  const buf2 = new Uint8Array(buf, 0, BYTE_LENGTH);
  return encode(buf2) as unknown as Hash;
}

export function parse(s: string): Hash {
  assertHash(s);
  return s;
}

export const emptyHash = '00000000000000000000000000000000' as unknown as Hash;

// Temp hashes needs to have the same length as non temp hashes. This is
// important because we split B+Tree nodes based on the size and we want the
// size to be the same independent of whether the hash is temp or not.

export const newTempHash = makeNewTempHashFunction();

/**
 * Creates a new temp hash function.
 */
export function makeNewTempHashFunction(): () => Hash {
  return makeNewFakeHashFunction('t/');
}

/**
 * Creates a new "Hash" that is a UUID.
 */
export function newUUIDHash(): Hash {
  return ('u/' + uuid()) as unknown as Hash;
}

/**
 * Creates a new fake hash function.
 * @param hashPrefix The prefix of the hash. If the prefix starts with 't/' it is
considered a temp hash.
 */
export function makeNewFakeHashFunction(hashPrefix: string): () => Hash {
  let tempHashCounter = 0;
  return () => {
    // Must not overlap with hashOf results
    return (hashPrefix +
      (tempHashCounter++)
        .toString()
        .padStart(STRING_LENGTH - hashPrefix.length, '0')) as unknown as Hash;
  };
}

export function isHash(v: unknown): v is Hash {
  return (
    typeof v === 'string' &&
    (hashRe.test(v) || tempHashRe.test(v) || uuidHashRe.test(v))
  );
}

export function isTempHash(v: unknown): v is Hash {
  return typeof v === 'string' && tempHashRe.test(v);
}

export function isUUIDHash(v: unknown): v is Hash {
  return typeof v === 'string' && uuidHashRe.test(v);
}

export function assertNotTempHash(hash: Hash): void {
  if (tempHashRe.test(hash as unknown as string)) {
    throw new Error('Unexpected temp hash');
  }
}

export function assertHash(v: unknown): asserts v is Hash {
  if (!isHash(v)) {
    throw new Error(`Invalid hash: '${v}'`);
  }
}

/**
 * Generates a fake hash useful for testing.
 */
export function fakeHash(s: string): Hash {
  const fake = 'fake';
  assert(
    /^[a-v0-9]*$/.test(s),
    `Fake hash must be a valid substring of a hash: ${s}`,
  );
  assert(s.length <= STRING_LENGTH - fake.length, 'Fake hash is too long');
  return (fake +
    s.padStart(STRING_LENGTH - fake.length, '0')) as unknown as Hash;
}
