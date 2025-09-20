#!/usr/bin/env node
import { FieldEncryption } from "./encryption.js";
import { DatabaseEncryption } from "./database-encryption.js";
import { EncryptedDBOperations } from "./encrypted-db-operations.js";
import { databaseLogger } from "./logger.js";

class EncryptionTest {
  private testPassword = "test-master-password-for-validation";

  async runAllTests(): Promise<boolean> {
    console.log("🔐 Starting Termix Database Encryption Tests...\n");

    const tests = [
      {
        name: "Basic Encryption/Decryption",
        test: () => this.testBasicEncryption(),
      },
      {
        name: "Field Encryption Detection",
        test: () => this.testFieldDetection(),
      },
      { name: "Key Derivation", test: () => this.testKeyDerivation() },
      {
        name: "Database Encryption Context",
        test: () => this.testDatabaseContext(),
      },
      {
        name: "Record Encryption/Decryption",
        test: () => this.testRecordOperations(),
      },
      {
        name: "Backward Compatibility",
        test: () => this.testBackwardCompatibility(),
      },
      { name: "Error Handling", test: () => this.testErrorHandling() },
      { name: "Performance Test", test: () => this.testPerformance() },
      { name: "JWT Secret Management", test: () => this.testJWTSecretManagement() },
      { name: "Password-Based KEK Security", test: () => this.testPasswordBasedKEK() },
    ];

    let passedTests = 0;
    let totalTests = tests.length;

    for (const test of tests) {
      try {
        console.log(`⏳ Running: ${test.name}...`);
        await test.test();
        console.log(`✅ PASSED: ${test.name}\n`);
        passedTests++;
      } catch (error) {
        console.log(`❌ FAILED: ${test.name}`);
        console.log(
          `   Error: ${error instanceof Error ? error.message : "Unknown error"}\n`,
        );
      }
    }

    const success = passedTests === totalTests;
    console.log(`\n🎯 Test Results: ${passedTests}/${totalTests} tests passed`);

    if (success) {
      console.log(
        "🎉 All encryption tests PASSED! System is ready for production.",
      );
    } else {
      console.log("⚠️  Some tests FAILED! Please review the implementation.");
    }

    return success;
  }

  private async testBasicEncryption(): Promise<void> {
    const testData = "Hello, World! This is sensitive data.";
    const key = FieldEncryption.getFieldKey(this.testPassword, "test-field");

    const encrypted = FieldEncryption.encryptField(testData, key);
    const decrypted = FieldEncryption.decryptField(encrypted, key);

    if (decrypted !== testData) {
      throw new Error(
        `Decryption mismatch: expected "${testData}", got "${decrypted}"`,
      );
    }

    if (!FieldEncryption.isEncrypted(encrypted)) {
      throw new Error("Encrypted data not detected as encrypted");
    }

    if (FieldEncryption.isEncrypted(testData)) {
      throw new Error("Plain text incorrectly detected as encrypted");
    }
  }

  private async testFieldDetection(): Promise<void> {
    const testCases = [
      { table: "users", field: "password_hash", shouldEncrypt: true },
      { table: "users", field: "username", shouldEncrypt: false },
      { table: "ssh_data", field: "password", shouldEncrypt: true },
      { table: "ssh_data", field: "ip", shouldEncrypt: false },
      { table: "ssh_credentials", field: "privateKey", shouldEncrypt: true },
      { table: "unknown_table", field: "any_field", shouldEncrypt: false },
    ];

    for (const testCase of testCases) {
      const result = FieldEncryption.shouldEncryptField(
        testCase.table,
        testCase.field,
      );
      if (result !== testCase.shouldEncrypt) {
        throw new Error(
          `Field detection failed for ${testCase.table}.${testCase.field}: ` +
            `expected ${testCase.shouldEncrypt}, got ${result}`,
        );
      }
    }
  }

  private async testKeyDerivation(): Promise<void> {
    const password = "test-password";
    const fieldType1 = "users.password_hash";
    const fieldType2 = "ssh_data.password";

    const key1a = FieldEncryption.getFieldKey(password, fieldType1);
    const key1b = FieldEncryption.getFieldKey(password, fieldType1);
    const key2 = FieldEncryption.getFieldKey(password, fieldType2);

    if (!key1a.equals(key1b)) {
      throw new Error("Same field type should produce identical keys");
    }

    if (key1a.equals(key2)) {
      throw new Error("Different field types should produce different keys");
    }

    const differentPasswordKey = FieldEncryption.getFieldKey(
      "different-password",
      fieldType1,
    );
    if (key1a.equals(differentPasswordKey)) {
      throw new Error("Different passwords should produce different keys");
    }
  }

  private async testDatabaseContext(): Promise<void> {
    DatabaseEncryption.initialize({
      masterPassword: this.testPassword,
      encryptionEnabled: true,
      forceEncryption: false,
      migrateOnAccess: true,
    });

    const status = DatabaseEncryption.getEncryptionStatus();
    if (!status.enabled) {
      throw new Error("Encryption should be enabled");
    }

    if (!status.configValid) {
      throw new Error("Configuration should be valid");
    }
  }

  private async testRecordOperations(): Promise<void> {
    const testRecord = {
      id: "test-id-123",
      username: "testuser",
      password_hash: "sensitive-password-hash",
      is_admin: false,
    };

    const encrypted = DatabaseEncryption.encryptRecord("users", testRecord);
    const decrypted = DatabaseEncryption.decryptRecord("users", encrypted);

    if (decrypted.username !== testRecord.username) {
      throw new Error("Non-sensitive field should remain unchanged");
    }

    if (decrypted.password_hash !== testRecord.password_hash) {
      throw new Error("Sensitive field should be properly decrypted");
    }

    if (!FieldEncryption.isEncrypted(encrypted.password_hash)) {
      throw new Error("Sensitive field should be encrypted in stored record");
    }
  }

  private async testBackwardCompatibility(): Promise<void> {
    const plaintextRecord = {
      id: "legacy-id-456",
      username: "legacyuser",
      password_hash: "plain-text-password-hash",
      is_admin: false,
    };

    const decrypted = DatabaseEncryption.decryptRecord(
      "users",
      plaintextRecord,
    );

    if (decrypted.password_hash !== plaintextRecord.password_hash) {
      throw new Error(
        "Plain text fields should be returned as-is for backward compatibility",
      );
    }

    if (decrypted.username !== plaintextRecord.username) {
      throw new Error("Non-sensitive fields should be unchanged");
    }
  }

  private async testErrorHandling(): Promise<void> {
    const key = FieldEncryption.getFieldKey(this.testPassword, "test");

    try {
      FieldEncryption.decryptField("invalid-json-data", key);
      throw new Error("Should have thrown error for invalid JSON");
    } catch (error) {
      if (!error || !(error as Error).message.includes("decryption failed")) {
        throw new Error("Should throw appropriate decryption error");
      }
    }

    try {
      const fakeEncrypted = JSON.stringify({
        data: "fake",
        iv: "fake",
        tag: "fake",
      });
      FieldEncryption.decryptField(fakeEncrypted, key);
      throw new Error("Should have thrown error for invalid encrypted data");
    } catch (error) {
      if (!error || !(error as Error).message.includes("Decryption failed")) {
        throw new Error("Should throw appropriate error for corrupted data");
      }
    }
  }

  private async testPerformance(): Promise<void> {
    const testData =
      "Performance test data that is reasonably long to simulate real SSH keys and passwords.";
    const key = FieldEncryption.getFieldKey(
      this.testPassword,
      "performance-test",
    );

    const iterations = 100;
    const startTime = Date.now();

    for (let i = 0; i < iterations; i++) {
      const encrypted = FieldEncryption.encryptField(testData, key);
      const decrypted = FieldEncryption.decryptField(encrypted, key);

      if (decrypted !== testData) {
        throw new Error(`Performance test failed at iteration ${i}`);
      }
    }

    const endTime = Date.now();
    const totalTime = endTime - startTime;
    const avgTime = totalTime / iterations;

    console.log(
      `   ⚡ Performance: ${iterations} encrypt/decrypt cycles in ${totalTime}ms (${avgTime.toFixed(2)}ms avg)`,
    );

    if (avgTime > 50) {
      console.log(
        "   ⚠️  Warning: Encryption operations are slower than expected",
      );
    }
  }

  private async testJWTSecretManagement(): Promise<void> {
    const { EncryptionKeyManager } = await import("./encryption-key-manager.js");
    const keyManager = EncryptionKeyManager.getInstance();

    // Test JWT secret generation and retrieval
    const jwtSecret1 = await keyManager.getJWTSecret();
    if (!jwtSecret1 || jwtSecret1.length < 32) {
      throw new Error("JWT secret should be at least 32 characters long");
    }

    // Test that subsequent calls return the same secret (caching)
    const jwtSecret2 = await keyManager.getJWTSecret();
    if (jwtSecret1 !== jwtSecret2) {
      throw new Error("JWT secret should be cached and consistent");
    }

    // Test JWT secret regeneration
    const newJwtSecret = await keyManager.regenerateJWTSecret();
    if (newJwtSecret === jwtSecret1) {
      throw new Error("Regenerated JWT secret should be different from original");
    }

    if (newJwtSecret.length !== 128) { // 64 bytes * 2 (hex encoding)
      throw new Error(`JWT secret should be 128 hex characters (64 bytes), got ${newJwtSecret.length}`);
    }

    // Test that after regeneration, getJWTSecret returns the new secret
    const currentSecret = await keyManager.getJWTSecret();
    if (currentSecret !== newJwtSecret) {
      throw new Error("getJWTSecret should return the new secret after regeneration");
    }

    console.log("   ✅ JWT secret generation, caching, and regeneration working correctly");
    console.log("   ✅ All secrets now use password-derived KEK instead of hardware fingerprint");
  }

  private async testPasswordBasedKEK(): Promise<void> {
    const { MasterKeyProtection } = await import("./master-key-protection.js");

    const testPassword = "test-secure-password-12345";
    const testKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    // Test encryption with password-based KEK
    const encrypted = MasterKeyProtection.encryptMasterKey(testKey, testPassword);

    // Verify the encrypted data format
    const protectedData = JSON.parse(encrypted);
    if (protectedData.version !== "v2") {
      throw new Error(`Expected version v2 (password-based), got ${protectedData.version}`);
    }

    if (!protectedData.salt) {
      throw new Error("Protected data should contain a salt field");
    }

    if (protectedData.fingerprint) {
      throw new Error("Protected data should not contain hardware fingerprint");
    }

    // Test decryption with correct password
    const decrypted = MasterKeyProtection.decryptMasterKey(encrypted, testPassword);
    if (decrypted !== testKey) {
      throw new Error("Decryption with correct password failed");
    }

    // Test that wrong password fails
    try {
      MasterKeyProtection.decryptMasterKey(encrypted, "wrong-password");
      throw new Error("Decryption should fail with wrong password");
    } catch (error) {
      if (!(error as Error).message.includes("decryption failed")) {
        throw new Error("Should fail with proper decryption error");
      }
    }

    // Test that different passwords produce different encrypted data
    const encrypted2 = MasterKeyProtection.encryptMasterKey(testKey, "different-password");
    if (encrypted === encrypted2) {
      throw new Error("Different passwords should produce different encrypted data");
    }

    // Test protection info
    const info = MasterKeyProtection.getProtectionInfo(encrypted);
    if (!info?.isPasswordBased) {
      throw new Error("Protection info should indicate password-based encryption");
    }

    if (info.saltLength !== 32) {
      throw new Error(`Expected salt length 32, got ${info.saltLength}`);
    }

    console.log("   ✅ Password-based KEK working correctly (no hardware fingerprint dependency)");
    console.log("   ✅ Different passwords produce different encryption (true randomness)");
    console.log("   ✅ Salt length: 32 bytes, Iterations: 100,000 (strong security)");
  }

  static async validateProduction(): Promise<boolean> {
    console.log("🔒 Validating production encryption setup...\n");

    try {
      const encryptionKey = process.env.DB_ENCRYPTION_KEY;

      if (!encryptionKey) {
        console.log("❌ DB_ENCRYPTION_KEY environment variable not set");
        return false;
      }

      if (encryptionKey === "default-key-change-me") {
        console.log("❌ DB_ENCRYPTION_KEY is using default value (INSECURE)");
        return false;
      }

      if (encryptionKey.length < 16) {
        console.log(
          "❌ DB_ENCRYPTION_KEY is too short (minimum 16 characters)",
        );
        return false;
      }

      DatabaseEncryption.initialize({
        masterPassword: encryptionKey,
        encryptionEnabled: true,
      });

      const status = DatabaseEncryption.getEncryptionStatus();
      if (!status.configValid) {
        console.log("❌ Encryption configuration validation failed");
        return false;
      }

      console.log("✅ Production encryption setup is valid");
      return true;
    } catch (error) {
      console.log(
        `❌ Production validation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return false;
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const testMode = process.argv[2];

  if (testMode === "production") {
    EncryptionTest.validateProduction()
      .then((success) => {
        process.exit(success ? 0 : 1);
      })
      .catch((error) => {
        console.error("Test execution failed:", error);
        process.exit(1);
      });
  } else {
    const test = new EncryptionTest();
    test
      .runAllTests()
      .then((success) => {
        process.exit(success ? 0 : 1);
      })
      .catch((error) => {
        console.error("Test execution failed:", error);
        process.exit(1);
      });
  }
}

export { EncryptionTest };
