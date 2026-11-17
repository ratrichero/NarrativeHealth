/** Live-suite config (LLM-EVAL-01): only the reliability tests that need real services. */
const base = require("./jest.config");

module.exports = {
  ...base,
  testPathIgnorePatterns: ["/node_modules/"],
  testMatch: ["**/__tests__/operate-02-reliability.test.ts"],
};
