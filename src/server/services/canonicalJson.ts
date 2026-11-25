/**
 * RFC 8785: JSON Canonicalization Scheme (JCS) Implementation
 * Ensures deterministic serialization of JSON payloads for cryptographic signatures and hash digests.
 *
 * Rules:
 * 1. Object keys sorted in ascending order by UTF-16 code unit (lexicographical byte order).
 * 2. No whitespace between tokens (commas, colons, brackets, braces).
 * 3. Numbers serialized deterministically per ECMAScript specification (reject NaN, Infinity, -0 -> 0).
 * 4. Strings escaped strictly (control chars U+0000 - U+001F, quote, backslash).
 * 5. Rejects undefined values, functions, symbols, and circular references.
 */

export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(`[RFC8785-JCS] ${message}`);
    this.name = 'CanonicalJsonError';
  }
}

export function canonicalizeJson(value: any, seen: Set<any> = new Set()): string {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new CanonicalJsonError(`Non-finite numbers (NaN, Infinity) are prohibited in canonical JSON: ${value}`);
    }
    // Handle negative zero per RFC 8785 (-0 -> 0)
    if (Object.is(value, -0)) {
      return '0';
    }
    return JSON.stringify(value);
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'undefined') {
    throw new CanonicalJsonError('Undefined values are prohibited in canonical JSON payloads.');
  }

  if (typeof value === 'function' || typeof value === 'symbol') {
    throw new CanonicalJsonError(`Functions and symbols are prohibited in canonical JSON payloads: ${typeof value}`);
  }

  if (typeof value === 'bigint') {
    throw new CanonicalJsonError('BigInt is not supported in standard JSON/RFC 8785.');
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      throw new CanonicalJsonError('Circular reference detected during JSON canonicalization.');
    }
    seen.add(value);

    try {
      if (Array.isArray(value)) {
        const elements = value.map(element => {
          if (typeof element === 'undefined') {
            return 'null';
          }
          return canonicalizeJson(element, seen);
        });
        return `[${elements.join(',')}]`;
      }

      // Plain Object: sort keys strictly by UTF-16 code units
      const keys = Object.keys(value).sort((a, b) => {
        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
      });

      const members: string[] = [];
      for (const key of keys) {
        const memberVal = value[key];
        // In objects, omit keys with undefined values or reject them
        if (typeof memberVal === 'undefined') {
          continue;
        }
        const canonKey = JSON.stringify(key);
        const canonVal = canonicalizeJson(memberVal, seen);
        members.push(`${canonKey}:${canonVal}`);
      }

      return `{${members.join(',')}}`;
    } finally {
      seen.delete(value);
    }
  }

  throw new CanonicalJsonError(`Unsupported data type encountered in JSON canonicalization: ${typeof value}`);
}
