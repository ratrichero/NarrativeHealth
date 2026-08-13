/**
 * Test Database Safety Guard
 *
 * This file ensures that integration tests never run against the production database.
 * It validates the TEST_DATABASE_URL before allowing any integration test to execute.
 */

const PRODUCTION_HOSTS = [
  '168.138.179.192', // Production IP from drizzle.config.json
  'production',
  'prod',
];

const TEST_DATABASE_NAMES = [
  'narrative_health_test',
  'test',
  'testing',
];

/**
 * Validates that the database URL is safe for integration testing.
 * Throws an error if the URL appears to target production.
 */
export function validateTestDatabaseUrl(url: string | undefined): void {
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Integration tests require an isolated test database. ' +
      'Set TEST_DATABASE_URL in your environment or .env file before running integration tests.'
    );
  }

  // Check if URL contains production host
  const urlLower = url.toLowerCase();
  for (const host of PRODUCTION_HOSTS) {
    if (urlLower.includes(host)) {
      throw new Error(
        `TEST_DATABASE_URL appears to target production database (contains "${host}"). ` +
        'Integration tests must use an isolated test database. ' +
        'DO NOT run integration tests against production.'
      );
    }
  }

  // Check if URL contains a test database name
  const hasTestDatabase = TEST_DATABASE_NAMES.some(name => urlLower.includes(name));
  if (!hasTestDatabase) {
    throw new Error(
      `TEST_DATABASE_URL does not appear to target a test database. ` +
      'Expected database name to contain one of: ' + TEST_DATABASE_NAMES.join(', ') + '. ' +
      'DO NOT run integration tests against production.'
    );
  }
}

/**
 * Ensures test database safety before running integration tests.
 * Call this in a global test setup file or before each integration test.
 */
export function ensureTestDatabaseSafety(): void {
  const testUrl = process.env.TEST_DATABASE_URL;
  validateTestDatabaseUrl(testUrl);
}
