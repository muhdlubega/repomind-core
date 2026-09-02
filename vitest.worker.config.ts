import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: "./test/integration/empty-worker.ts",
      miniflare: {
        compatibilityDate: "2026-08-28",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        bindings: { TEST_MIGRATIONS: await readD1Migrations("./migrations") }
      }
    }))
  ],
  test: { include: ["test/integration/**/*.test.ts"], setupFiles: ["./test/integration/setup.ts"] }
});
