/**
 * P3 Integration Test - Smoke Test
 *
 * This is a minimal smoke test to verify the test database infrastructure works.
 * It does NOT test the full P3 orchestrator - it only verifies that:
 * 1. Test database safety guard works
 * 2. Database connection works (when TEST_DATABASE_URL is set)
 */

import { validateTestDatabaseUrl } from './test-setup';

describe('P3 Integration Smoke Test', () => {
  describe('Safety Guard Validation', () => {
    test('test database safety guard rejects production URLs', () => {
      // Should reject missing URL
      expect(() => validateTestDatabaseUrl(undefined)).toThrow();

      // Should reject production host
      expect(() => validateTestDatabaseUrl('postgresql://user@168.138.179.192/db')).toThrow();

      // Should reject non-test database name
      expect(() => validateTestDatabaseUrl('postgresql://user@localhost/narrative_health')).toThrow();

      // Should accept valid test database
      expect(() => validateTestDatabaseUrl('postgresql://user@localhost/narrative_health_test')).not.toThrow();
    });
  });

  describe('Test Database Connection', () => {
    const testUrl = process.env.TEST_DATABASE_URL;

    beforeAll(() => {
      if (!testUrl) {
        console.warn('TEST_DATABASE_URL not set - skipping connection tests');
      } else {
        validateTestDatabaseUrl(testUrl);
      }
    });

    test('TEST_DATABASE_URL environment variable is set and safe', () => {
      if (!testUrl) {
        return; // Skip if not set
      }
      expect(testUrl).toBeDefined();
      expect(testUrl).toContain('test');
    });

    test('can connect to test database', async () => {
      if (!testUrl) {
        return; // Skip if not set
      }

      const { db } = require('@/db');
      const result = await db.execute('SELECT 1 as connected');
      expect(result.rows[0].connected).toBe(1);
    });
  });
});
