import { UserDataExport, type UserExportData } from "./user-data-export.js";
import { UserDataImport, type ImportResult } from "./user-data-import.js";
import { databaseLogger } from "./logger.js";

/**
 * 导入导出功能测试
 *
 * Linus原则：简单的冒烟测试，确保基本功能工作
 */
class ImportExportTest {

  /**
   * 测试导出功能
   */
  static async testExport(userId: string): Promise<boolean> {
    try {
      databaseLogger.info("Testing user data export functionality", {
        operation: "import_export_test",
        test: "export",
        userId,
      });

      // 测试加密导出
      const encryptedExport = await UserDataExport.exportUserData(userId, {
        format: 'encrypted',
        scope: 'user_data',
        includeCredentials: true,
      });

      // 验证导出数据结构
      const validation = UserDataExport.validateExportData(encryptedExport);
      if (!validation.valid) {
        databaseLogger.error("Export validation failed", {
          operation: "import_export_test",
          test: "export_validation",
          errors: validation.errors,
        });
        return false;
      }

      // 获取统计信息
      const stats = UserDataExport.getExportStats(encryptedExport);

      databaseLogger.success("Export test completed successfully", {
        operation: "import_export_test",
        test: "export_success",
        totalRecords: stats.totalRecords,
        breakdown: stats.breakdown,
        encrypted: stats.encrypted,
      });

      return true;
    } catch (error) {
      databaseLogger.error("Export test failed", error, {
        operation: "import_export_test",
        test: "export_failed",
        userId,
      });
      return false;
    }
  }

  /**
   * 测试导入功能（dry-run）
   */
  static async testImportDryRun(userId: string, exportData: UserExportData): Promise<boolean> {
    try {
      databaseLogger.info("Testing user data import functionality (dry-run)", {
        operation: "import_export_test",
        test: "import_dry_run",
        userId,
      });

      // 执行dry-run导入
      const result = await UserDataImport.importUserData(userId, exportData, {
        dryRun: true,
        replaceExisting: false,
        skipCredentials: false,
        skipFileManagerData: false,
      });

      if (result.success) {
        databaseLogger.success("Import dry-run test completed successfully", {
          operation: "import_export_test",
          test: "import_dry_run_success",
          summary: result.summary,
        });
        return true;
      } else {
        databaseLogger.error("Import dry-run test failed", {
          operation: "import_export_test",
          test: "import_dry_run_failed",
          errors: result.summary.errors,
        });
        return false;
      }
    } catch (error) {
      databaseLogger.error("Import dry-run test failed with exception", error, {
        operation: "import_export_test",
        test: "import_dry_run_exception",
        userId,
      });
      return false;
    }
  }

  /**
   * 运行完整的导入导出测试
   */
  static async runFullTest(userId: string): Promise<boolean> {
    try {
      databaseLogger.info("Starting full import/export test suite", {
        operation: "import_export_test",
        test: "full_suite",
        userId,
      });

      // 1. 测试导出
      const exportSuccess = await this.testExport(userId);
      if (!exportSuccess) {
        return false;
      }

      // 2. 获取导出数据用于导入测试
      const exportData = await UserDataExport.exportUserData(userId, {
        format: 'encrypted',
        scope: 'user_data',
        includeCredentials: true,
      });

      // 3. 测试导入（dry-run）
      const importSuccess = await this.testImportDryRun(userId, exportData);
      if (!importSuccess) {
        return false;
      }

      databaseLogger.success("Full import/export test suite completed successfully", {
        operation: "import_export_test",
        test: "full_suite_success",
        userId,
      });

      return true;
    } catch (error) {
      databaseLogger.error("Full import/export test suite failed", error, {
        operation: "import_export_test",
        test: "full_suite_failed",
        userId,
      });
      return false;
    }
  }

  /**
   * 验证JSON序列化和反序列化
   */
  static async testJSONSerialization(userId: string): Promise<boolean> {
    try {
      databaseLogger.info("Testing JSON serialization/deserialization", {
        operation: "import_export_test",
        test: "json_serialization",
        userId,
      });

      // 导出为JSON字符串
      const jsonString = await UserDataExport.exportUserDataToJSON(userId, {
        format: 'encrypted',
        pretty: true,
      });

      // 解析JSON
      const parsedData = JSON.parse(jsonString);

      // 验证解析后的数据
      const validation = UserDataExport.validateExportData(parsedData);
      if (!validation.valid) {
        databaseLogger.error("JSON serialization validation failed", {
          operation: "import_export_test",
          test: "json_validation_failed",
          errors: validation.errors,
        });
        return false;
      }

      // 测试从JSON导入（dry-run）
      const importResult = await UserDataImport.importUserDataFromJSON(userId, jsonString, {
        dryRun: true,
      });

      if (importResult.success) {
        databaseLogger.success("JSON serialization test completed successfully", {
          operation: "import_export_test",
          test: "json_serialization_success",
          jsonSize: jsonString.length,
        });
        return true;
      } else {
        databaseLogger.error("JSON import test failed", {
          operation: "import_export_test",
          test: "json_import_failed",
          errors: importResult.summary.errors,
        });
        return false;
      }
    } catch (error) {
      databaseLogger.error("JSON serialization test failed", error, {
        operation: "import_export_test",
        test: "json_serialization_exception",
        userId,
      });
      return false;
    }
  }
}

export { ImportExportTest };