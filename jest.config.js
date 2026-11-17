/** @type {import('jest').Config} */
const config = {
  preset: "ts-jest",
  testEnvironment: "node",
  setupFiles: ["<rootDir>/jest.setup.js"],
  testMatch: ["**/__tests__/**/*.test.{ts,tsx}"],
  // LLM-EVAL-01: the reliability suite hits live databases/providers — run it
  // explicitly with `npm run test:live` instead of in the default pipeline.
  testPathIgnorePatterns: ["/node_modules/", "operate-02-reliability"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          ...require("./tsconfig.json").compilerOptions,
          noEmit: false,
          isolatedModules: false,
        },
      },
    ],
  },
};

module.exports = config;