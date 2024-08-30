export {
  IDBNotFoundError,
  TransactionClosedError,
  dropAllDatabases,
  dropDatabase,
  getDefaultPuller,
  makeIDBName,
} from 'replicache';
export type {
  AsyncIterableIteratorToArray,
  ClientGroupID,
  ClientID,
  CreateKVStore,
  ExperimentalDiff,
  ExperimentalDiffOperation,
  ExperimentalDiffOperationAdd,
  ExperimentalDiffOperationChange,
  ExperimentalDiffOperationDel,
  ExperimentalIndexDiff,
  ExperimentalNoIndexDiff,
  ExperimentalWatchCallbackForOptions,
  ExperimentalWatchIndexCallback,
  ExperimentalWatchIndexOptions,
  ExperimentalWatchNoIndexCallback,
  ExperimentalWatchNoIndexOptions,
  ExperimentalWatchOptions,
  GetIndexScanIterator,
  GetScanIterator,
  HTTPRequestInfo,
  IndexDefinition,
  IndexDefinitions,
  IndexKey,
  IterableUnion,
  JSONObject,
  JSONValue,
  KVRead,
  KVStore,
  KVWrite,
  KeyTypeForScanOptions,
  MaybePromise,
  MutatorDefs,
  MutatorReturn,
  PatchOperation,
  ReadTransaction,
  ReadonlyJSONObject,
  ReadonlyJSONValue,
  ScanIndexOptions,
  ScanNoIndexOptions,
  ScanOptionIndexedStartKey,
  ScanOptions,
  ScanResult,
  SubscribeOptions,
  TransactionEnvironment,
  TransactionLocation,
  TransactionReason,
  UpdateNeededReason,
  VersionNotSupportedResponse,
  WriteTransaction,
} from 'replicache';
export type {
  Query,
  DefaultQueryResultRow as EmptyQueryResultRow,
  SchemaToRow,
  Smash,
  QueryRowType,
  QueryReturnType,
} from 'zql/src/zql/query/query.js';
export type {Schema} from 'zql/src/zql/query/schema.js';
export type {ZeroOptions} from './client/options.js';
export {Zero, type SchemaDefs as QueryDefs} from './client/zero.js';
