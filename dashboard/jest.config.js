module.exports = {
  preset: "ts-jest",
  testEnvironment: "jest-environment-node",
  // Must match tsconfig's paths or every copied import breaks.
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/$1" },
  testMatch: ["<rootDir>/__tests__/**/*.test.ts"],
}
