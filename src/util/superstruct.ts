import * as s from "superstruct";

export function superstructAssert<T, S>(
  value: unknown,
  struct: s.Struct<T, S>
): asserts value is T {
  if (typeof MINIFLARE !== "undefined") {
    // TODO(greg): figure out how to detect when running
    // on `wrangler dev` and assert there as well.
    s.assert(value, struct);
  }
}
