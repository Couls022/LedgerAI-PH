import Database from 'better-sqlite3';
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { dbContext } from "./context";
import { sealAuditRowSync } from "./auditSeal";
import path from "path";
import fs from "fs";

import { AsyncLocalStorage } from "async_hooks";

export { schema };

const activeTxClientsAls = new AsyncLocalStorage<WeakSet<object>>();
const clientTxMutexMap = new WeakMap<object, Promise<void>>();

async function withClientTransactionLock<T>(client: object, fn: () => Promise<T>): Promise<T> {
  const previous = clientTxMutexMap.get(client) || Promise.resolve();
  let releaseLock!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  const chained = previous.then(() => current, () => current);
  clientTxMutexMap.set(client, chained);

  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    releaseLock();
  }
}

// Proxy to get the DB from the current request context
export const db = new Proxy({} as any, {
  get(target, prop) {
    const activeDb = dbContext.getStore();
    if (!activeDb) {
      throw new Error("NO_ACTIVE_DATABASE: No active company database context found in AsyncLocalStorage context.");
    }

    if (prop === 'insert') {
      return function(table: any) {
        const builder = (activeDb as any).insert(table);
        if (table !== schema.auditLogs) {
          return builder;
        }
        const client = (activeDb as any)?.$client || (activeDb as any)?.session?.client;
        const origValues = builder.values.bind(builder);
        builder.values = (val: any) => {
          if (val && typeof val === 'object' && !Array.isArray(val)) {
            return origValues(sealAuditRowSync(client, val));
          }
          return origValues(val);
        };
        return builder;
      };
    }

    if (prop === 'transaction') {
      return async function(transactionFn: any, config?: any) {
        const client = (activeDb as any)?.$client || (activeDb as any)?.session?.client;
        if (!client) {
          return await transactionFn(db, config);
        }

        const runSql = async (sqlStr: string) => {
          if (typeof client.exec === 'function') {
            client.exec(sqlStr);
          } else if (typeof client.execute === 'function') {
            await client.execute(sqlStr);
          } else if (typeof (client as any).run === 'function') {
            (client as any).run(sqlStr);
          }
        };

        const currentActiveSet = activeTxClientsAls.getStore();
        const isTrueNested = Boolean(currentActiveSet && currentActiveSet.has(client) && client.inTransaction);

        const executeTransactionBody = async (isNested: boolean) => {
          let attempts = 0;
          const maxAttempts = 10;
          const baseDelayMs = 40;

          while (true) {
            attempts++;
            const savepoint = "sp_" + Date.now() + "_" + Math.floor(Math.random() * 1000000);

            try {
              if (isNested) {
                await runSql("SAVEPOINT " + savepoint);
              } else {
                await runSql("BEGIN IMMEDIATE");
              }
            } catch (beginErr: any) {
              const isBusy =
                beginErr?.message?.includes("SQLITE_BUSY") ||
                beginErr?.message?.includes("database is locked") ||
                beginErr?.code === "SQLITE_BUSY" ||
                beginErr?.rawCode === 5;

              if (isBusy && attempts < maxAttempts && !isNested) {
                const delay = Math.min(baseDelayMs * Math.pow(2, attempts - 1), 600) + Math.random() * 40;
                console.warn(`[SQLite Concurrency] SQLITE_BUSY encountered on attempt ${attempts}/${maxAttempts}. Retrying in ${Math.round(delay)}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
              }
              throw beginErr;
            }

            try {
              const nextSet = new WeakSet<object>();
              nextSet.add(client);
              const result = await activeTxClientsAls.run(nextSet, () => transactionFn(db, config));
              if (isNested) {
                await runSql("RELEASE SAVEPOINT " + savepoint);
              } else {
                await runSql("COMMIT");
              }
              return result;
            } catch (txErr: any) {
              try {
                if (isNested) {
                  await runSql("ROLLBACK TO SAVEPOINT " + savepoint);
                  try {
                    await runSql("RELEASE SAVEPOINT " + savepoint);
                  } catch (_) {}
                } else if (client.inTransaction !== false) {
                  await runSql("ROLLBACK");
                }
              } catch (rollbackErr) {
                console.error("[SQLite Concurrency] Rollback error:", rollbackErr);
              }
              throw txErr;
            }
          }
        };

        if (isTrueNested) {
          return await executeTransactionBody(true);
        }
        return await withClientTransactionLock(client, () => executeTransactionBody(Boolean(client.inTransaction)));
      };
    }

    return (activeDb as any)[prop];
  }
});

