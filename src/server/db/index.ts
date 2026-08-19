import Database from 'better-sqlite3';
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { dbContext } from "./context";
import path from "path";
import fs from "fs";

export { schema };

// Proxy to get the DB from the current request context
export const db = new Proxy({} as any, {
  get(target, prop) {
    const activeDb = dbContext.getStore();
    if (!activeDb) {
      throw new Error("NO_ACTIVE_DATABASE: No active company database context found in AsyncLocalStorage context.");
    }

    if (prop === 'transaction') {
      return async function(transactionFn: any, config?: any) {
        let attempts = 0;
        const maxAttempts = 5;
        const baseDelayMs = 50;
        
        while (true) {
          try {
            attempts++;
            // We just pass the db proxy as tx since better-sqlite3 doesn't support async transactions well with Drizzle
            return await transactionFn(db, config);
          } catch (error: any) {
            const isBusy = 
              error?.message?.includes("SQLITE_BUSY") || 
              error?.message?.includes("database is locked") ||
              error?.code === "SQLITE_BUSY" ||
              error?.rawCode === 5;
              
            if (isBusy && attempts < maxAttempts) {
              const delay = baseDelayMs * Math.pow(2, attempts - 1) + Math.random() * 20;
              console.warn(`[SQLite Concurrency] SQLITE_BUSY encountered on attempt ${attempts}/${maxAttempts}. Retrying in ${Math.round(delay)}ms...`);
              await new Promise(resolve => setTimeout(resolve, delay));
            } else {
              throw error;
            }
          }
        }
      };
    }

    return (activeDb as any)[prop];
  }
});

