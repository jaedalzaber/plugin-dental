import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests run on their own. Integration tests use the AppointIt checkout next to this folder
// (../booking-and-cms): its test database harness (embedded PostgreSQL) and its core code. The harness applies the
// migrations of the folders in TEST_PLUGIN_PACKAGES, so it gets this plugin's tables.
process.env.TEST_PLUGIN_PACKAGES ??= fileURLToPath(new URL(".", import.meta.url));

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
