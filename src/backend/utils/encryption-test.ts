#!/usr/bin/env node
import { FieldEncryption } from './encryption.js';
import { DatabaseEncryption } from './database-encryption.js';
import { EncryptedDBOperations } from './encrypted-db-operations.js';
import { databaseLogger } from './logger.js';

class EncryptionTest {
  private testPassword = 'test-master-password-for-validation';

  async runAllTests(): Promise<boolean> {
    console.log('🔐 Starting Termix Database Encryption Tests...\n');

    const tests = [
      { name: 'Basic Encryption/Decryption', test: () => this.testBasicEncryption() },
      { name: 'Field Encryption Detection', test: () => this.testFieldDetection() },
      { name: 'Key Derivation', test: () => this.testKeyDerivation() },
      { name: 'Database Encryption Context', test: () => this.testDatabaseContext() },
      { name: 'Record Encryption/Decryption', test: () => this.testRecordOperations() },
      { name: 'Backward Compatibility', test: () => this.testBackwardCompatibility() },
      { name: 'Error Handling', test: () => this.testErrorHandling() },
      { name: 'Performance Test', test: () => this.testPerformance() }
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
        console.log(`   Error: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
      }
    }

    const success = passedTests === totalTests;
    console.log(`\n🎯 Test Results: ${passedTests}/${totalTests} tests passed`);

    if (success) {
      console.log('🎉 All encryption tests PASSED! System is ready for production.');
    } else {
      console.log('⚠️  Some tests FAILED! Please review the implementation.');
    }

    return success;
  }

  private async testBasicEncryption(): Promise<void> {
    const testData = 'Hello, World! This is sensitive data.';
    const key = FieldEncryption.getFieldKey(this.testPassword, 'test-field');

    const encrypted = FieldEncryption.encryptField(testData, key);
    const decrypted = FieldEncryption.decryptField(encrypted, key);

    if (decrypted !== testData) {
      throw new Error(`Decryption mismatch: expected "${testData}", got "${decrypted}"`);
    }

    if (!FieldEncryption.isEncrypted(encrypted)) {
      throw new Error('Encrypted data not detected as encrypted');
    }

    if (FieldEncryption.isEncrypted(testData)) {
      throw new Error('Plain text incorrectly detected as encrypted');
    }
  }

  private async testFieldDetection(): Promise<void> {
    const testCases = [
      { table: 'users', field: 'password_hash', shouldEncrypt: true },
      { table: 'users', field: 'username', shouldEncrypt: false },
      { table: 'ssh_data', field: 'password', shouldEncrypt: true },
      { table: 'ssh_data', field: 'ip', shouldEncrypt: false },
      { table: 'ssh_credentials', field: 'privateKey', shouldEncrypt: true },
      { table: 'unknown_table', field: 'any_field', shouldEncrypt: false }
    ];

    for (const testCase of testCases) {
      const result = FieldEncryption.shouldEncryptField(testCase.table, testCase.field);
      if (result !== testCase.shouldEncrypt) {
        throw new Error(
          `Field detection failed for ${testCase.table}.${testCase.field}: ` +
          `expected ${testCase.shouldEncrypt}, got ${result}`
        );
      }
    }
  }

  private async testKeyDerivation(): Promise<void> {
    const password = 'test-password';
    const fieldType1 = 'users.password_hash';
    const fieldType2 = 'ssh_data.password';

    const key1a = FieldEncryption.getFieldKey(password, fieldType1);
    const key1b = FieldEncryption.getFieldKey(password, fieldType1);
    const key2 = FieldEncryption.getFieldKey(password, fieldType2);

    if (!key1a.equals(key1b)) {
      throw new Error('Same field type should produce identical keys');
    }

    if (key1a.equals(key2)) {
      throw new Error('Different field types should produce different keys');
    }

    const differentPasswordKey = FieldEncryption.getFieldKey('different-password', fieldType1);
    if (key1a.equals(differentPasswordKey)) {
      throw new Error('Different passwords should produce different keys');
    }
  }

  private async testDatabaseContext(): Promise<void> {
    DatabaseEncryption.initialize({
      masterPassword: this.testPassword,
      encryptionEnabled: true,
      forceEncryption: false,
      migrateOnAccess: true
    });

    const status = DatabaseEncryption.getEncryptionStatus();
    if (!status.enabled) {
      throw new Error('Encryption should be enabled');
    }

    if (!status.configValid) {
      throw new Error('Configuration should be valid');
    }
  }

  private async testRecordOperations(): Promise<void> {
    const testRecord = {
      id: 'test-id-123',
      username: 'testuser',
      password_hash: 'sensitive-password-hash',
      is_admin: false
    };

    const encrypted = DatabaseEncryption.encryptRecord('users', testRecord);
    const decrypted = DatabaseEncryption.decryptRecord('users', encrypted);

    if (decrypted.username !== testRecord.username) {
      throw new Error('Non-sensitive field should remain unchanged');
    }

    if (decrypted.password_hash !== testRecord.password_hash) {
      throw new Error('Sensitive field should be properly decrypted');
    }

    if (!FieldEncryption.isEncrypted(encrypted.password_hash)) {
      throw new Error('Sensitive field should be encrypted in stored record');
    }
  }

  private async testBackwardCompatibility(): Promise<void> {
    const plaintextRecord = {
      id: 'legacy-id-456',
      username: 'legacyuser',
      password_hash: 'plain-text-password-hash',
      is_admin: false
    };

    const decrypted = DatabaseEncryption.decryptRecord('users', plaintextRecord);

    if (decrypted.password_hash !== plaintextRecord.password_hash) {
      throw new Error('Plain text fields should be returned as-is for backward compatibility');
    }

    if (decrypted.username !== plaintextRecord.username) {
      throw new Error('Non-sensitive fields should be unchanged');
    }
  }

  private async testErrorHandling(): Promise<void> {
    const key = FieldEncryption.getFieldKey(this.testPassword, 'test');

    try {
      FieldEncryption.decryptField('invalid-json-data', key);
      throw new Error('Should have thrown error for invalid JSON');
    } catch (error) {
      if (!error || !(error as Error).message.includes('decryption failed')) {
        throw new Error('Should throw appropriate decryption error');
      }
    }

    try {
      const fakeEncrypted = JSON.stringify({ data: 'fake', iv: 'fake', tag: 'fake' });
      FieldEncryption.decryptField(fakeEncrypted, key);
      throw new Error('Should have thrown error for invalid encrypted data');
    } catch (error) {
      if (!error || !(error as Error).message.includes('Decryption failed')) {
        throw new Error('Should throw appropriate error for corrupted data');
      }
    }
  }

  private async testPerformance(): Promise<void> {
    const testData = 'Performance test data that is reasonably long to simulate real SSH keys and passwords.';
    const key = FieldEncryption.getFieldKey(this.testPassword, 'performance-test');

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

    console.log(`   ⚡ Performance: ${iterations} encrypt/decrypt cycles in ${totalTime}ms (${avgTime.toFixed(2)}ms avg)`);

    if (avgTime > 50) {
      console.log('   ⚠️  Warning: Encryption operations are slower than expected');
    }
  }

  static async validateProduction(): Promise<boolean> {
    console.log('🔒 Validating production encryption setup...\n');

    try {
      const encryptionKey = process.env.DB_ENCRYPTION_KEY;

      if (!encryptionKey) {
        console.log('❌ DB_ENCRYPTION_KEY environment variable not set');
        return false;
      }

      if (encryptionKey === 'default-key-change-me') {
        console.log('❌ DB_ENCRYPTION_KEY is using default value (INSECURE)');
        return false;
      }

      if (encryptionKey.length < 16) {
        console.log('❌ DB_ENCRYPTION_KEY is too short (minimum 16 characters)');
        return false;
      }

      DatabaseEncryption.initialize({
        masterPassword: encryptionKey,
        encryptionEnabled: true
      });

      const status = DatabaseEncryption.getEncryptionStatus();
      if (!status.configValid) {
        console.log('❌ Encryption configuration validation failed');
        return false;
      }

      console.log('✅ Production encryption setup is valid');
      return true;

    } catch (error) {
      console.log(`❌ Production validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const testMode = process.argv[2];

  if (testMode === 'production') {
    EncryptionTest.validateProduction()
      .then((success) => {
        process.exit(success ? 0 : 1);
      })
      .catch((error) => {
        console.error('Test execution failed:', error);
        process.exit(1);
      });
  } else {
    const test = new EncryptionTest();
    test.runAllTests()
      .then((success) => {
        process.exit(success ? 0 : 1);
      })
      .catch((error) => {
        console.error('Test execution failed:', error);
        process.exit(1);
      });
  }
}

export { EncryptionTest };