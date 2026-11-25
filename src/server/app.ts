import fs from "fs";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import authRoutes from "./routes/auth";
import companyRoutes from "./routes/companies";
import userRoutes from "./routes/users";
import dashboardRoutes from "./routes/dashboard";
import accountingRoutes from "./routes/accounting";
import taxRoutes from "./routes/tax";
import auditRoutes from "./routes/audit";
import reportsRoutes from "./routes/reports";
import restoreRoutes from "./routes/restore";
import notificationsRoutes from "./routes/notifications";
import documentsRoutes from "./routes/documents";
import searchRoutes from "./routes/search";
import geminiRoutes from "./routes/gemini";
import budgetsRoutes from "./routes/budgets";
import brandingRoutes from "./routes/branding";
import aiRoutes from "./routes/ai";
import masterDataRoutes, { systemArchiveRouter } from "./routes/masterData";
import auditEngagementsRoutes from "./routes/auditEngagements";
import auditPlanningRoutes from "./routes/auditPlanning";
import auditAdvancedRoutes from "./routes/auditAdvanced";
import licensingAndLanRoutes from "./routes/licensingAndLan";
import operationsRoutes from "./routes/operations";
import laiCleanupRoutes from "./routes/laiCleanup";
import backupRoutes from "./routes/backup";
import settingsRoutes from "./routes/settings";
import birComplianceRoutes from "./routes/birCompliance";
import electronicFilingRoutes from "./routes/electronicFiling";
import bankReconciliationRoutes from "./routes/bankReconciliation";
import businessIntelligenceRoutes from "./routes/businessIntelligence";
import rbacRoutes from "./routes/rbac";
import journeyRoutes from "./routes/journey";
import { statutoryRulesRouter } from "./routes/statutoryRules";
import { CompanyManager } from "./services/companyManager";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { parseToken, requireValidLicense, enforcePasswordChangeGuard } from "./auth";
import { companyContextMiddleware } from "./middleware/companyContext";
import { StartupValidator } from "./services/startupValidator";
import { OperationalLogger } from "./services/operationalLogger";
import { AntiRollbackService } from "./services/antiRollbackService";
import { AutomatedBackupScheduler } from "./services/automatedBackupScheduler";
import { ArchiveRetentionScheduler } from "./services/archiveRetentionService";
import { AuthorityHeartbeatClient } from "./services/authorityHeartbeatClient";
import { ServerTelemetryService } from "./services/serverTelemetryService";
import { jsonTimestampReplacer } from "../shared/timestampUtils";

// Run startup validation on load
const startupCheck = StartupValidator.validate();
if (!startupCheck.success) {
  console.error("[CRITICAL STARTUP ERROR]", startupCheck.errors);
}

const isTestRunner =
  Boolean(process.env.VITEST) ||
  process.env.NODE_ENV === 'test' ||
  Boolean(process.env.NODE_TEST_CONTEXT) ||
  process.execArgv.some(arg => arg.includes('test')) ||
  process.argv.some(arg => arg.includes('test'));

// Initialize Company Manager immediately, then start automated schedulers.
// Strictly enforce Zero-Data Clean Start: never auto-seed sample/demo companies on startup
// unless explicitly opted-in via LEDGERAI_ALLOW_AUTO_DEMO_SEED=true.
CompanyManager.init()
  .then(async () => {
    if (
      process.env.LEDGERAI_ALLOW_AUTO_DEMO_SEED === 'true' &&
      !process.env.VITEST &&
      process.env.NODE_ENV !== 'test' &&
      process.env.NODE_ENV !== 'production'
    ) {
      await CompanyManager.ensureStressPreviewSeeded();
    }
  })
  .catch(err => console.error("Failed to init CompanyManager:", err))
  .finally(() => {
    if (!isTestRunner) {
      AutomatedBackupScheduler.startScheduler();
      ArchiveRetentionScheduler.startScheduler();
    }
  });

// Start background monotonic time integrity heartbeat (advances last-known-time state safely)
AntiRollbackService.startBackgroundHeartbeat(30000);

// Start background online authority heartbeat loop (telemetry & single-device anti-piracy sync)
if (!isTestRunner) {
  AuthorityHeartbeatClient.startHeartbeatLoop(60000);
}

export function createApp() {
  const app = express();
  app.set("json replacer", jsonTimestampReplacer);

  app.use(cors({
    origin: true,
    credentials: true,
  }));
  app.use(express.json({ limit: "25mb" }));
  app.use((req, _res, next) => {
    if (!req.body || typeof req.body !== "object") {
      req.body = {};
    }
    next();
  });
  app.use(cookieParser());

  // Request correlation & operational request logging middleware
  app.use((req, res, next) => {
    const start = Date.now();
    (req as any).requestId = (req.headers["x-request-id"] as string) || `req-${crypto.randomUUID().slice(0, 8)}`;
    
    res.on('finish', () => {
      const durationMs = Date.now() - start;
      if (req.path.startsWith('/api')) {
        OperationalLogger.info('HTTP Request', {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs
        }, {
          requestId: (req as any).requestId,
          operation: `${req.method} ${req.path}`
        });
      }
    });

    next();
  });

  // DB Context Middleware
  app.use(companyContextMiddleware);

  // Global Forced Password-Change Guard (blocks normalized/unmatched traversal bypasses)
  app.use(enforcePasswordChangeGuard);

  // Global Centralized Backend License Enforcement
  app.use(requireValidLicense);

  app.get("/api/health", (req, res) => {
    const pool = CompanyManager.getPoolMetrics();
    res.json({
      status: "healthy",
      application: "LedgerAI PH",
      version: "1.0.0",
      environment: process.env.NODE_ENV || "production",
      deploymentMode: ServerTelemetryService.getDeploymentMode(),
      lanHostname: ServerTelemetryService.getConfiguredLanHostname(),
      uptimeSeconds: ServerTelemetryService.getUptimeSeconds(),
      openDatabaseCount: pool.openCompanyCount,
      timestamp: new Date().toISOString()
    });
  });

  app.use("/api/auth", authRoutes);
    app.use("/api/companies", companyRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/accounting", accountingRoutes);
  app.use("/api/tax", taxRoutes);
  app.use("/api/audit", auditRoutes);
  app.use("/api/reports", reportsRoutes);
  app.use("/api/restore", restoreRoutes);
  app.use("/api/notifications", notificationsRoutes);
  app.use("/api/documents", documentsRoutes);
  app.use("/api/search", searchRoutes);
  app.use("/api/gemini", geminiRoutes);
  app.use("/api/budgets", budgetsRoutes);
  app.use("/api/branding", brandingRoutes);
  app.use("/api/ai", aiRoutes);
  app.use("/api/master-data", masterDataRoutes);
  app.use("/api/audit-engagements", auditEngagementsRoutes);
  app.use("/api/audit-planning", auditPlanningRoutes);
  app.use("/api/audit-advanced", auditAdvancedRoutes);
  app.use("/api/operations", operationsRoutes);
  app.use("/api/lai-cleanup", laiCleanupRoutes);
  app.use("/api/backup", backupRoutes);
  app.use("/api/settings", settingsRoutes);
  app.use("/api/compliance/bir", birComplianceRoutes);
  app.use("/api/filing", electronicFilingRoutes);
  app.use("/api/banking", bankReconciliationRoutes);
  app.use("/api/bi", businessIntelligenceRoutes);
  app.use("/api/rbac", rbacRoutes);
  app.use("/api/journey", journeyRoutes);
  app.use("/api/system", systemArchiveRouter);
  app.use("/api", statutoryRulesRouter);
  app.use("/api", licensingAndLanRoutes);

  // Catch-all for unmatched API requests to prevent returning index.html
  app.use("/api", (req, res) => {
    res.status(404).json({
      error: "NOT_FOUND",
      message: `The requested endpoint ${req.method} ${req.originalUrl} does not exist on this server.`
    });
  });

  // Global Express JSON Error Handler for API routes
  app.use((err: any, req: any, res: any, next: any) => {
    const statusCode = err.status || err.statusCode || 500;
    OperationalLogger.error('Unhandled API Error', err, { requestId: (req as any)?.requestId });
    ServerTelemetryService.recordError({
      code: err.code || "INTERNAL_ERROR",
      message: err.message || "An unexpected error occurred on the server",
      path: req?.originalUrl,
      method: req?.method,
      statusCode,
    });
    res.status(statusCode).json({
      error: err.code || "INTERNAL_ERROR",
      message: err.message || "An unexpected error occurred on the server"
    });
  });

  return app;
}

