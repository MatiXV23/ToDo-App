import path from "node:path";
import { defineConfig } from "vitest/config";

try {
  process.loadEnvFile(".env");
} catch {
  // CI: variables del entorno.
}

const testDatabaseUrl =
  process.env.DATABASE_URL_TEST ?? "postgres://todoapp:todoapp@localhost:5432/todoapp_test";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    // Los tests de integración comparten una base: se ejecutan de a un archivo.
    fileParallelism: false,
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/integration/global-setup.ts"],
          setupFiles: ["tests/integration/setup.ts"],
          env: {
            DATABASE_URL: testDatabaseUrl,
            DEV_LOGIN_ENABLED: "false",
            GITHUB_WEBHOOK_SECRET: "test-webhook-secret",
            AI_API_KEY: "",
          },
          testTimeout: 20_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
