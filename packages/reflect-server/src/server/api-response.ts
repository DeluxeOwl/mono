import type {ReadonlyJSONValue} from 'shared/src/json.js';
import {ErrorWithResponse} from './errors.js';

export type APIErrorCode = 404; // Add more as necessary.
export type APIResource = 'rooms'; // Add more as necessary.

export type APIErrorInfo = {
  code: APIErrorCode;
  resource: string;
  message: string;
};

export type APIResponse<T extends ReadonlyJSONValue> =
  | {
      result: T;
      error: null;
    }
  | {
      result: null;
      error: APIErrorInfo;
    };

export function makeAPIResponse<T extends ReadonlyJSONValue>(
  result: T,
): APIResponse<T> {
  return {result, error: null};
}

export class APIError extends ErrorWithResponse {
  readonly #info: APIErrorInfo;

  constructor(code: APIErrorCode, resource: string, message: string) {
    super(`${code}: ${message}${resource ? ' (' + resource + ')' : ''}`);
    this.#info = {code, resource, message};
  }

  response(): Response {
    const apiResponse: APIResponse<null> = {
      result: null,
      error: this.#info,
    };
    return new Response(JSON.stringify(apiResponse));
  }
}
