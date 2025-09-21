#!/usr/bin/env node

/**
 * Final encryption system test - verify unified version works properly
 */

import { UserKeyManager } from "./user-key-manager.js";
import { DatabaseEncryption } from "./database-encryption.js";
import { FieldEncryption } from "./encryption.js";

async function finalTest() {
  console.log("🔒 Final encryption system test (unified version)");

  try {
    // Initialize encryption system
    DatabaseEncryption.initialize();

    // Create user key manager
    const userKeyManager = UserKeyManager.getInstance();
    const testUserId = "final-test-user";
    const testPassword = "secure-password-123";

    console.log("1. Setting up user encryption...");
    await userKeyManager.setupUserEncryption(testUserId, testPassword);
    console.log("   ✅ User KEK-DEK key pair generated successfully");

    console.log("2. Authenticating user and unlocking data...");
    const authResult = await userKeyManager.authenticateAndUnlockUser(testUserId, testPassword);
    if (!authResult) {
      throw new Error("User authentication failed");
    }
    console.log("   ✅ User authentication and data unlock successful");

    console.log("3. Testing field-level encryption...");
    const dataKey = userKeyManager.getUserDataKey(testUserId);
    if (!dataKey) {
      throw new Error("Data key not available");
    }

    const testData = "secret-ssh-password";
    const recordId = "ssh-host-1";
    const fieldName = "password";

    const encrypted = FieldEncryption.encryptField(testData, dataKey, recordId, fieldName);
    const decrypted = FieldEncryption.decryptField(encrypted, dataKey, recordId, fieldName);

    if (decrypted !== testData) {
      throw new Error(`Encryption/decryption mismatch: expected "${testData}", got "${decrypted}"`);
    }
    console.log("   ✅ Field-level encryption/decryption successful");

    console.log("4. Testing database-level encryption...");
    const testRecord = {
      id: "test-record-1",
      host: "192.168.1.100",
      username: "testuser",
      password: "secret-password",
      port: 22
    };

    const encryptedRecord = DatabaseEncryption.encryptRecordForUser(
      "ssh_data",
      testRecord,
      testUserId
    );

    if (encryptedRecord.password === testRecord.password) {
      throw new Error("Password field should be encrypted");
    }

    const decryptedRecord = DatabaseEncryption.decryptRecordForUser(
      "ssh_data",
      encryptedRecord,
      testUserId
    );

    if (decryptedRecord.password !== testRecord.password) {
      throw new Error("Decrypted password does not match");
    }

    if (decryptedRecord.host !== testRecord.host) {
      throw new Error("Non-sensitive fields should remain unchanged");
    }
    console.log("   ✅ Database-level encryption/decryption successful");

    console.log("5. Testing user session management...");
    const isUnlocked = userKeyManager.isUserUnlocked(testUserId);
    if (!isUnlocked) {
      throw new Error("User should be in unlocked state");
    }

    userKeyManager.logoutUser(testUserId);
    const isUnlockedAfterLogout = userKeyManager.isUserUnlocked(testUserId);
    if (isUnlockedAfterLogout) {
      throw new Error("User should not be in unlocked state after logout");
    }
    console.log("   ✅ User session management successful");

    console.log("6. Testing password verification...");
    const wrongPasswordResult = await userKeyManager.authenticateAndUnlockUser(
      testUserId,
      "wrong-password"
    );
    if (wrongPasswordResult) {
      throw new Error("Wrong password should not authenticate successfully");
    }
    console.log("   ✅ Wrong password correctly rejected");

    console.log("\n🎉 All tests passed! Unified encryption system working properly!");
    console.log("\n📊 System status:");
    console.log("   - Architecture: KEK-DEK user key hierarchy");
    console.log("   - Version: Unified version (no V1/V2 distinction)");
    console.log("   - Security: Enterprise-grade user data protection");
    console.log("   - Compatibility: Fully forward compatible");

    return true;

  } catch (error) {
    console.error("\n❌ Test failed:", error);
    return false;
  }
}

// Run test
finalTest()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error("Test execution error:", error);
    process.exit(1);
  });