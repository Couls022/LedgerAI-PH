import { Request, Response, NextFunction } from "express";
import { CompanyManager } from "../services/companyManager";
import { dbContext } from "../db/context";
import { parseToken } from "../auth";
import { isPublicOrCreationRoutePath } from "../utils/requestPath";

export const companyContextMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    let companyId: string | null = null;
    
    // 1. Authoritative: Parse token (Session-based)
    const authHeader = req.headers.authorization;
    const token = req.cookies?.token || (authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : null);
    if (token) {
       const parsed = parseToken(token);
       if (parsed?.companyId) {
          companyId = parsed.companyId;
       }
    }
    
    // 2. Validate/Load context
    if (companyId) {
        try {
            // Ensure company exists in the authoritative registry or temp manifest cache
            const manifest = await CompanyManager.getCompanyManifest(companyId);
            
            if (!manifest) {
                // Clear stale/invalid cookie token so it doesn't block future requests
                res.clearCookie("token");
                if (req.cookies && req.cookies.token) {
                  delete req.cookies.token;
                }
                if (req.headers.cookie) {
                  req.headers.cookie = req.headers.cookie.replace(/token=[^;]+;?\s*/g, "").trim();
                }
                if (req.headers.authorization) {
                  delete req.headers.authorization;
                }

                // If the route is a public/unauthenticated endpoint (such as company profile creation, listing, auth login, or health checks),
                // allow the request to proceed as unauthenticated rather than blocking with a SESSION_EXPIRED error.
                if (isPublicOrCreationRoutePath(req.originalUrl)) {
                  return next();
                }

                res.status(401).json({ error: "SESSION_EXPIRED", message: "Company not found in registry" });
                return;
            }
            
            // Get DB connection
            const companyDb = await CompanyManager.getCompanyDb(companyId as string);
            
            req.activeCompany = { id: companyId } as any; // Simplified for typing, will be fully populated in auth middleware

            if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method.toUpperCase())) {
              const targetCid = companyId as string;
              const isTest = process.env.NODE_ENV === 'test' || !!process.env.VITEST;
              const delay = isTest ? 1000 : 150;
              res.on("finish", () => {
                if (
                  res.statusCode >= 200 &&
                  res.statusCode < 400 &&
                  !(req as any).skipSnapshotSync &&
                  !req.originalUrl.includes('/backups/integrity-check')
                ) {
                  CompanyManager.scheduleSnapshotSync(targetCid, delay);
                }
              });
            }
            
            // Run in context for the full request lifetime with active in-flight request tracking
            const trackedCompanyId = companyId as string;
            CompanyManager.trackRequestStart(trackedCompanyId);
            return new Promise<void>((resolve) => {
              let finalized = false;
              const finalize = () => {
                if (finalized) return;
                finalized = true;
                CompanyManager.trackRequestEnd(trackedCompanyId);
                resolve();
              };
              res.on("finish", finalize);
              res.on("close", finalize);
              dbContext.run(companyDb, () => {
                next();
              });
            });
        } catch(e: any) {
            console.error("Failed to load company DB context:", e.message);
            if (isPublicOrCreationRoutePath(req.originalUrl)) {
              res.clearCookie("token");
              return next();
            }

            if (e.message && e.message.startsWith("CORRUPT_DATABASE_QUARANTINED")) {
              res.status(503).json({
                error: "CORRUPT_DATABASE_QUARANTINED",
                message: e.message,
                diagnostics: CompanyManager.getRecoveryDiagnostics(companyId as string)
              });
              return;
            }

            res.status(500).json({ error: "DATABASE_ERROR", message: "Failed to initialize company context" });
        }
    } else {
        // Some routes might not need company context, let them through
        next();
    }
};
