import { CompanyManager } from "./companyManager";
import { OperationalLogger } from "./operationalLogger";

export class MasterDataService {
  /**
   * Clears all stress test data, company profiles, transaction logs, and temporary tables,
   * leaving the system in a pristine 'ready-to-use' state.
   */
  public static async clearAllStressTestData(options?: {
    confirmClear?: boolean;
    authorizedByUserId?: string;
  }): Promise<{ success: boolean; message: string; purgedCount: number }> {
    if (!options?.confirmClear) {
      throw new Error("CLEAR_STRESS_TEST_DATA_CONFIRMATION_REQUIRED: Explicit confirmClear=true is required.");
    }

    OperationalLogger.info("MasterDataService", {
      message: "Initiating Clear All Stress Test Data utility..."
    });

    const result = await CompanyManager.factoryResetAllCompanies({
      confirmFactoryReset: true,
      scope: 'SYNTHETIC_ONLY',
      authorizedByUserId: options?.authorizedByUserId || 'SYSTEM',
      reason: 'Master Data utility: Clear All Stress Test Data & Purge Synthetic Workspaces'
    });

    OperationalLogger.info("MasterDataService", {
      message: `Successfully purged ${result.purgedCount} synthetic/stress-test workspace(s) while preserving ${result.preservedCount} production/pilot workspace(s).`,
    });

    return {
      success: true,
      message: `Purged ${result.purgedCount} synthetic/stress-test workspace(s). Protected production and pilot company profiles remain preserved.`,
      purgedCount: result.purgedCount
    };
  }
}
