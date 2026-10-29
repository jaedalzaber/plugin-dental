import { defineConfig } from "vitest/config";

// Unit tests run on their own. Integration tests use the AppointIt checkout next to this folder
// (../booking-and-cms): its test database harness (embedded PostgreSQL) and its core code.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          env: { LOG_LEVEL: "silent" },
          include: ["src/**/*.test.ts"],
          exclude: ["**/*.int.test.ts", "**/node_modules/**"],
        },
      },
      {
        test: {
          name: "integration",
          env: { LOG_LEVEL: "silent" },
          include: ["src/**/*.int.test.ts"],
          globalSetup: ["../booking-and-cms/packages/testing/src/global-setup.ts"],
          fileParallelism: false,
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
          testTimeout: 60_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
