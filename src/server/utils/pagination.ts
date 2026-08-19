import { Request } from 'express';
import { sql, eq, lt, gt, or, and, SQL, AnyColumn } from 'drizzle-orm';

export interface CursorPayload {
  val: string | number;
  id: string;
}

export interface PaginationParams {
  limit: number;
  cursor: string | null;
  decodedCursor: CursorPayload | null;
  search: string | null;
  status: string | null;
  fromDate: string | null;
  toDate: string | null;
  raw: boolean;
  paginate: boolean;
}

export function parsePaginationParams(req: Request, defaultLimit = 50, maxLimit = 200): PaginationParams {
  const limitQuery = parseInt(req.query.limit as string, 10);
  let limit = isNaN(limitQuery) || limitQuery <= 0 ? defaultLimit : limitQuery;
  if (limit > maxLimit) {
    limit = maxLimit;
  }

  const cursor = (req.query.cursor as string) || null;
  const decodedCursor = decodeCursor(cursor);

  const searchRaw = (req.query.search as string) || (req.query.q as string) || null;
  const search = searchRaw && searchRaw.trim().length > 0 ? searchRaw.trim() : null;

  const statusRaw = (req.query.status as string) || null;
  const status = statusRaw && statusRaw.trim().length > 0 ? statusRaw.trim() : null;

  const fromDate = (req.query.fromDate as string) || (req.query.startDate as string) || null;
  const toDate = (req.query.toDate as string) || (req.query.endDate as string) || null;

  const raw = req.query.raw === 'true';
  const paginate = req.query.paginate === 'true' || Boolean(req.query.limit || req.query.cursor);

  return {
    limit,
    cursor,
    decodedCursor,
    search,
    status,
    fromDate,
    toDate,
    raw,
    paginate,
  };
}

export function encodeCursor(val: string | number, id: string): string {
  const payload = [val, id];
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(cursorStr?: string | null): CursorPayload | null {
  if (!cursorStr || typeof cursorStr !== 'string') return null;
  try {
    const json = Buffer.from(cursorStr, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed) && parsed.length >= 2) {
      return { val: parsed[0], id: String(parsed[1]) };
    }
    return null;
  } catch {
    return null;
  }
}

export function buildCursorCondition(
  sortCol: AnyColumn,
  idCol: AnyColumn,
  cursor: CursorPayload | null,
  direction: 'ASC' | 'DESC' = 'DESC'
): SQL | undefined {
  if (!cursor) return undefined;

  const val = cursor.val;
  const id = cursor.id;

  if (direction === 'DESC') {
    return or(
      lt(sortCol, val),
      and(eq(sortCol, val), lt(idCol, id))
    );
  } else {
    return or(
      gt(sortCol, val),
      and(eq(sortCol, val), gt(idCol, id))
    );
  }
}

export function formatPaginatedResponse<T>(options: {
  items: T[];
  limit: number;
  getSortValAndId: (item: T) => { val: string | number; id: string };
  totalCount?: number;
  raw?: boolean;
}) {
  const { items, limit, getSortValAndId, totalCount, raw = false } = options;

  let hasNextPage = false;
  let data = items;

  if (items.length > limit) {
    hasNextPage = true;
    data = items.slice(0, limit);
  }

  let nextCursor: string | null = null;
  if (hasNextPage && data.length > 0) {
    const lastItem = data[data.length - 1];
    const { val, id } = getSortValAndId(lastItem);
    nextCursor = encodeCursor(val, id);
  }

  if (raw) {
    return data;
  }

  return {
    data,
    pagination: {
      limit,
      hasNextPage,
      nextCursor,
      totalCount: totalCount !== undefined ? totalCount : data.length,
    },
  };
}
