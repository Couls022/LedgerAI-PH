import { Request, Response, NextFunction } from "express";
import { CompanyManager } from "../services/companyManager";
import { dbContext } from "../db/context";
import { parseToken } from "../auth";

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
            // Ensure company exists in the authoritative registry
            const companiesList = await CompanyManager.listCompanies();
            const manifest = companiesList.find(c => c.id === companyId);
            
            if (!manifest) {
                // Clear stale/invalid cookie token so it doesn't block future requests
                res.clearCookie("token");

                // If the route is a public/unauthenticated endpoint (such as company profile creation, listing, auth login, or health checks),
                // allow the request to proceed as unauthenticated rather than blocking with a SESSION_EXPIRED error.
                const isPublicOrCreationRoute = 
                  req.originalUrl.startsWith('/api/companies') ||
                  req.originalUrl.startsWith('/api/auth') ||
                  req.originalUrl.startsWith('/api/health') ||
                  req.originalUrl.startsWith('/api/restore') ||
                  req.originalUrl.startsWith('/api/admin') ||
                  req.originalUrl.includes('/licensing/');

                if (isPublicOrCreationRoute) {
                  return next();
                }

                res.status(401).json({ error: "SESSION_EXPIRED", message: "Company not found in registry" });
                return;
            }
            
            // Get DB connection
            const companyDb = await CompanyManager.getCompanyDb(companyId as string);
            
            req.activeCompany = { id: companyId } as any; // Simplified for typing, will be fully populated in auth middleware
            
            // Run in context
            dbContext.run(companyDb, () => next());
        } catch(e: any) {
            console.error("Failed to load company DB context:", e.message);
            res.status(500).json({ error: "DATABASE_ERROR", message: "Failed to initialize company context" });
        }
    } else {
        // Some routes might not need company context, let them through
        next();
    }
};
